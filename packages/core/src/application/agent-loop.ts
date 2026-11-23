import { randomUUID } from "node:crypto";
import { buildModelRequest } from "../context/context-builder.js";
import { AgentError, errorMessage } from "../domain/errors.js";
import type { AgentEvent, EventPayload, EventType } from "../domain/events.js";
import { createEvent } from "../domain/events.js";
import type { AssistantMessage, ToolCall, ToolObservation } from "../domain/messages.js";
import type { TaskPlanUpdate } from "../domain/plan.js";
import type { RunState } from "../domain/run-state.js";
import { needsVerification, reduceEvent, replayRun } from "../domain/run-state.js";
import type { ApprovalPort } from "../ports/approval.js";
import type { ArtifactStore } from "../ports/artifacts.js";
import type { EventStore } from "../ports/event-store.js";
import type { ModelPort } from "../ports/model.js";
import { LoopDetector } from "../runtime/loop-detector.js";
import type { PolicyEngine } from "../runtime/policy-engine.js";
import type { ToolRegistry } from "../runtime/tool-registry.js";

export interface RuntimeObserver {
  onEvent?(event: AgentEvent): void | Promise<void>;
  onTextDelta?(text: string, runId: string): void;
  onReasoningDelta?(text: string, runId: string): void;
}

export interface AgentLoopOptions {
  model: ModelPort;
  modelName: string;
  store: EventStore;
  artifacts: ArtifactStore;
  tools: ToolRegistry;
  approval: ApprovalPort;
  policy: PolicyEngine;
  systemPrompt: string;
  observer?: RuntimeObserver;
  maxIterations?: number;
  maxContextTokens?: number;
}

export class AgentLoop {
  private readonly loops = new LoopDetector();
  private sequence = 0;
  private steeringVersion = 0;
  private appendChain: Promise<void> = Promise.resolve();
  private state: RunState;

  private constructor(
    private readonly runId: string,
    initialEvents: AgentEvent[],
    private readonly options: AgentLoopOptions,
  ) {
    this.sequence = initialEvents.length;
    this.state = replayRun(runId, initialEvents);
  }

  static async create(runId: string, options: AgentLoopOptions): Promise<AgentLoop> {
    return new AgentLoop(runId, await options.store.load(runId), options);
  }

  async run(signal: AbortSignal): Promise<RunState> {
    if (this.state.status !== "running") {
      return this.state;
    }
    try {
      for (let iteration = 1; iteration <= (this.options.maxIterations ?? 40); iteration += 1) {
        this.throwIfCancelled(signal);
        await this.flushSteering();
        const steeringAtStart = this.steeringVersion;
        const assistant = await this.nextAssistant(iteration, signal);
        await this.append("message.assistant", { message: assistant });
        if (!assistant.toolCalls?.length) {
          await this.flushSteering();
          if (this.steeringVersion !== steeringAtStart) {
            continue;
          }
          if (await this.complete(assistant, steeringAtStart)) {
            return this.state;
          }
          continue;
        }
        for (const call of assistant.toolCalls) {
          await this.executeCall(call, signal);
          if (this.isBlocked()) {
            return this.state;
          }
        }
        await this.flushSteering();
      }
      await this.append("run.failed", {
        error: "Maximum iterations reached before verified completion",
        recoverable: true,
      });
    } catch (error) {
      if (signal.aborted) {
        if (this.state.status === "running") {
          await this.append("run.cancelled", { reason: "Cancelled by user" });
        }
      } else if (this.state.status === "running") {
        await this.append("run.failed", {
          error: errorMessage(error),
          recoverable: error instanceof AgentError ? error.recoverable : false,
        });
      }
    }
    return this.state;
  }

  private async flushSteering(): Promise<void> {
    for (const [instructionId, task] of [...this.state.steeringRequests]) {
      if (!this.state.steeringRequests.has(instructionId)) {
        continue;
      }
      await this.append("message.user", {
        message: { role: "user", source: "user", content: task },
        steeringId: instructionId,
      });
    }
  }

  async steer(task: string): Promise<void> {
    const content = task.trim();
    if (!content) {
      throw new AgentError("Steering instruction cannot be empty", "configuration");
    }
    const instructionId = randomUUID();
    const requestVersion = ++this.steeringVersion;
    await this.enqueueAppend(async () => {
      if (this.state.status !== "running") {
        throw new AgentError("Run is not active", "configuration");
      }
      await this.appendNow("run.steered", { instructionId, task: content });
    }).catch((error) => {
      if (this.steeringVersion === requestVersion) {
        this.steeringVersion -= 1;
      }
      throw error;
    });
  }

  private async nextAssistant(iteration: number, signal: AbortSignal): Promise<AssistantMessage> {
    const built = buildModelRequest(this.state, {
      model: this.options.modelName,
      systemPrompt: this.options.systemPrompt,
      tools: this.options.tools,
      maxTokens: this.options.maxContextTokens ?? 100_000,
      remainingIterations: (this.options.maxIterations ?? 40) - iteration + 1,
    });
    if (built.compaction) {
      await this.append("context.compacted", built.compaction);
    }
    const request = built.request;
    let completed: AssistantMessage | undefined;
    for await (const event of this.options.model.stream(request, signal)) {
      if (event.type === "text.delta") {
        this.options.observer?.onTextDelta?.(event.text, this.runId);
      } else if (event.type === "reasoning.delta") {
        this.options.observer?.onReasoningDelta?.(event.text, this.runId);
      } else if (event.type === "usage") {
        if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
          await this.append("model.usage", {
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
          });
        }
      } else if (event.type === "message.completed") {
        completed = event.message;
      }
    }
    if (!completed) {
      throw new AgentError("Provider stream ended without a complete message", "provider", true);
    }
    return completed;
  }

  private async complete(assistant: AssistantMessage, steeringAtStart: number): Promise<boolean> {
    if (this.steeringVersion !== steeringAtStart) {
      return false;
    }
    if (needsVerification(this.state)) {
      const attempt = this.state.verificationAttempts + 1;
      if (attempt > 2) {
        await this.append("run.failed", {
          error: "Code changed but no successful verification command was recorded",
          recoverable: true,
        });
        return true;
      }
      await this.append("verification.requested", {
        attempt,
        reason:
          "Harness completion check: code changed without a later successful verification command. Run the smallest relevant test, typecheck, lint, or build now. Do not give a final response until it passes; if no check exists, add or identify a concrete executable check.",
      });
      return false;
    }
    const evidence =
      this.state.lastVerificationSeq > 0
        ? "verified command exit code 0"
        : "no code verification required";
    await this.append("verification.finished", { success: true, evidence });
    if (this.steeringVersion !== steeringAtStart) {
      return false;
    }
    await this.append("run.completed", {
      summary: assistant.content || "Task completed",
      verification: this.state.lastVerificationSeq > 0 ? "passed" : "not-required",
    });
    return true;
  }

  private async executeCall(call: ToolCall, signal: AbortSignal): Promise<void> {
    await this.append("tool.proposed", { call });
    const repeated = this.loops.record(call);
    if (repeated) {
      await this.recordError(call, repeated);
      return;
    }
    const tool = this.options.tools.get(call.name);
    if (!tool) {
      await this.recordError(call, `Unknown tool: ${call.name}`);
      return;
    }
    let input: unknown;
    try {
      input = tool.inputSchema.parse(JSON.parse(call.arguments));
    } catch (error) {
      await this.recordError(
        call,
        `Invalid tool arguments: ${errorMessage(error)}. Expected schema: ${JSON.stringify(tool.inputSchema)}`,
      );
      return;
    }

    const policy = this.options.policy.evaluate(tool, input);
    if (policy.action === "deny") {
      await this.append("tool.decided", {
        callId: call.id,
        decision: "rejected",
        reason: policy.reason,
      });
      await this.recordError(call, policy.reason);
      return;
    }
    if (policy.action === "ask") {
      await this.append("tool.approval_required", {
        callId: call.id,
        risk: policy.risk,
        reason: policy.reason,
      });
      const approval = await this.options.approval.approve(
        { runId: this.runId, call, risk: policy.risk, reason: policy.reason },
        signal,
      );
      await this.append("tool.decided", {
        callId: call.id,
        decision: approval.approved ? "approved" : "rejected",
        reason: approval.reason,
      });
      if (!approval.approved) {
        await this.recordError(call, approval.reason);
        return;
      }
    } else {
      await this.append("tool.decided", {
        callId: call.id,
        decision: "approved",
        reason: policy.reason,
      });
    }

    await this.append("tool.started", { callId: call.id });
    try {
      this.throwIfCancelled(signal);
      const result = await tool.execute(input, {
        runId: this.runId,
        cwd: this.state.cwd,
        signal,
        artifacts: this.options.artifacts,
      });
      await this.append("tool.result", {
        result: {
          callId: call.id,
          name: call.name,
          status: result.success === false ? "error" : "success",
          summary: result.summary,
          content: result.content,
          ...(result.artifacts ? { artifacts: result.artifacts } : {}),
          ...(result.changedFiles ? { changedFiles: result.changedFiles } : {}),
          ...(result.verification ? { verification: result.verification } : {}),
        },
      });
      if (result.planUpdate) {
        await this.updatePlan(result.planUpdate);
      }
      if (call.name === "report_blocked") {
        await this.append("run.blocked", { reason: (input as { reason: string }).reason });
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      await this.recordError(call, errorMessage(error));
    }
  }

  private async updatePlan(update: TaskPlanUpdate): Promise<void> {
    const current = this.state.plan;
    await this.append("plan.updated", {
      plan: {
        id: current?.id ?? randomUUID(),
        title: update.title ?? current?.title ?? "Task plan",
        revision: (current?.revision ?? 0) + 1,
        steps: structuredClone(update.steps),
      },
    });
  }

  private async recordError(call: ToolCall, message: string): Promise<void> {
    const result: ToolObservation = {
      callId: call.id,
      name: call.name,
      status: "error",
      summary: message,
      content: JSON.stringify({ error: message, tool: call.name }),
    };
    await this.append("tool.result", { result });
  }

  private append<Type extends EventType>(type: Type, payload: EventPayload<Type>): Promise<void> {
    return this.enqueueAppend(() => this.appendNow(type, payload));
  }

  private enqueueAppend(operation: () => Promise<void>): Promise<void> {
    const result = this.appendChain.then(operation, operation);
    this.appendChain = result.catch(() => undefined);
    return result;
  }

  private async appendNow<Type extends EventType>(
    type: Type,
    payload: EventPayload<Type>,
  ): Promise<void> {
    const event = createEvent(
      {
        eventId: randomUUID(),
        runId: this.runId,
        seq: ++this.sequence,
        timestamp: new Date().toISOString(),
      },
      type,
      payload,
    );
    await this.options.store.append(event);
    reduceEvent(this.state, event);
    await this.options.observer?.onEvent?.(event);
  }

  private isBlocked(): boolean {
    return this.state.status === "blocked";
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AgentError("Cancelled by user", "cancelled");
    }
  }
}
