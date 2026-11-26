import { randomUUID } from "node:crypto";
import { buildModelRequest } from "../context/context-builder.js";
import { AgentError, errorMessage } from "../domain/errors.js";
import type { AgentEvent, EventPayload, EventType } from "../domain/events.js";
import { createEvent } from "../domain/events.js";
import type { AssistantMessage, ToolCall, ToolObservation } from "../domain/messages.js";
import type { TaskPlanUpdate } from "../domain/plan.js";
import type { RunState } from "../domain/run-state.js";
import { reduceEvent, replayRun, verificationReport } from "../domain/run-state.js";
import type { RequiredCheck } from "../domain/verification.js";
import { formatCommand, formatVerificationEvidence } from "../domain/verification.js";
import type { ApprovalPort } from "../ports/approval.js";
import type { ArtifactStore } from "../ports/artifacts.js";
import type { EventStore } from "../ports/event-store.js";
import type { ModelPort } from "../ports/model.js";
import type { SubagentPort } from "../ports/subagent.js";
import type { UserInputPort, UserInputQuestion } from "../ports/user-input.js";
import { LoopDetector } from "../runtime/loop-detector.js";
import type { PolicyDecision, PolicyEngine } from "../runtime/policy-engine.js";
import type { ToolRegistry } from "../runtime/tool-registry.js";
import { ToolScheduler } from "../runtime/tool-scheduler.js";

export interface RuntimeObserver {
  onEvent?(event: AgentEvent): void | Promise<void>;
  onTextDelta?(text: string, runId: string): void;
  onReasoningDelta?(text: string, runId: string): void;
  onToolOutputDelta?(runId: string, callId: string, text: string): void;
}

export interface AgentLoopOptions {
  model: ModelPort;
  modelName: string;
  store: EventStore;
  artifacts: ArtifactStore;
  tools: ToolRegistry;
  approval: ApprovalPort;
  policy: PolicyEngine;
  userInput?: UserInputPort;
  subagents?: SubagentPort;
  systemPrompt: string;
  permissionMode?: import("../runtime/policy-engine.js").PermissionMode;
  dontAsk?: boolean;
  bypassPermissions?: boolean;
  autoReview?: import("../ports/auto-review.js").AutoReviewPort;
  projectTrusted?: boolean;
  cacheKey?: string;
  observer?: RuntimeObserver;
  maxIterations?: number;
  maxContextTokens?: number;
  requiredChecks?: readonly RequiredCheck[];
}

export class AgentLoop {
  private readonly loops = new LoopDetector();
  private readonly scheduler = new ToolScheduler();
  private readonly scopeRejections = new Map<string, number>();
  private scopeBlockedCallId: string | undefined;
  private sequence = 0;
  private iteration = 0;
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
        const executions = assistant.toolCalls.map((call) => {
          const concurrency = this.options.tools.get(call.name)?.concurrency ?? "exclusive";
          return this.scheduler.schedule(concurrency, () => this.executeCall(call, signal));
        });
        const results = await Promise.allSettled(executions);
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) throw rejected.reason;
        if (this.isBlocked()) {
          return this.state;
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

  async setMode(mode: import("../runtime/policy-engine.js").PermissionMode): Promise<void> {
    if (this.state.permissionMode === "read-only") {
      throw new AgentError("Read-only mode cannot be changed during a run", "configuration");
    }
    if (this.state.permissionMode !== mode) {
      await this.append("mode.changed", { mode, reason: "Mode changed through API" });
    }
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
    this.iteration = iteration;
    const built = buildModelRequest(this.state, {
      model: this.options.modelName,
      systemPrompt: this.options.systemPrompt,
      tools: this.options.tools,
      maxTokens: this.options.maxContextTokens ?? 100_000,
      estimateScale: this.state.tokenEstimateRatio,
      ...(this.options.cacheKey ? { cacheKey: this.options.cacheKey } : {}),
    });
    if (built.compaction) {
      await this.append("context.compacted", built.compaction);
    }
    built.request.messages = await this.hydrateImages(built.request.messages);
    if (built.request.runtimeMessages) {
      built.request.runtimeMessages = await this.hydrateImages(built.request.runtimeMessages);
    }
    await this.append("model.started", {
      iteration,
      model: this.options.modelName,
      estimatedInputTokens: built.estimatedTokens,
      ...(built.request.cache?.key ? { cacheKey: built.request.cache.key } : {}),
      ...(built.request.cache
        ? {
            staticPrefixHash: built.request.cache.staticPrefixHash,
            conversationPrefixHash: built.request.cache.conversationPrefixHash,
            requestHash: built.request.cache.requestHash,
          }
        : {}),
    });
    const startedAt = Date.now();
    let completed: AssistantMessage | undefined;
    try {
      for await (const event of this.options.model.stream(built.request, signal)) {
        if (event.type === "text.delta") {
          this.options.observer?.onTextDelta?.(event.text, this.runId);
        } else if (event.type === "reasoning.delta") {
          this.options.observer?.onReasoningDelta?.(event.text, this.runId);
        } else if (event.type === "usage") {
          await this.append("model.usage", {
            iteration,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            uncachedInputTokens: event.uncachedInputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheWriteTokens: event.cacheWriteTokens,
          });
        } else if (event.type === "message.completed") {
          completed = event.message;
        }
      }
      if (!completed) {
        throw new AgentError("Provider stream ended without a complete message", "provider", true);
      }
      if (!completed.content.trim() && !completed.toolCalls?.length) {
        throw new AgentError("Provider returned an empty assistant message", "provider", true);
      }
    } catch (error) {
      await this.append("model.failed", {
        iteration,
        model: this.options.modelName,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
        recoverable: error instanceof AgentError ? error.recoverable : false,
      });
      throw error;
    }
    await this.append("model.completed", {
      iteration,
      model: this.options.modelName,
      durationMs: Date.now() - startedAt,
      contentLength: completed.content.length,
      toolCalls: completed.toolCalls?.length ?? 0,
    });
    return completed;
  }

  private async complete(assistant: AssistantMessage, steeringAtStart: number): Promise<boolean> {
    if (this.steeringVersion !== steeringAtStart) {
      return false;
    }
    if (this.state.permissionMode === "plan") {
      if (this.state.dontAsk) {
        await this.append("run.blocked", {
          reason: "Plan approval is required, but dontAsk is enabled for this run",
        });
        return true;
      }
      if (!this.state.plan) {
        await this.append("verification.requested", {
          attempt: this.state.verificationAttempts + 1,
          reason:
            "Plan mode requires a visible plan before approval. Use update_plan with concrete steps, then present the plan for user approval. Do not edit files or run non-read-only commands.",
        });
        return false;
      }
      await this.append("plan.awaiting_approval", {
        planId: this.state.plan.id,
        requestedMode: "manual",
      });
      return true;
    }
    const report = verificationReport(this.state, this.options.requiredChecks);
    if (!report.passed) {
      const attempt = this.state.verificationAttempts + 1;
      if (attempt > 2) {
        const missing = report.pendingChecks.map((check) => check.id).join(", ");
        await this.append("run.failed", {
          error: missing
            ? `Required checks did not pass after the latest mutation: ${missing}`
            : "Code changed but the latest verification command did not pass",
          recoverable: true,
        });
        return true;
      }
      const required = report.pendingChecks.map(
        (check) => `${check.id}: ${formatCommand(check.command, check.args)}`,
      );
      await this.append("verification.requested", {
        attempt,
        reason: required.length
          ? `Harness completion check: run these required checks now and do not finish until each latest result passes: ${required.join("; ")}. Cite their real results in the final response.`
          : "Harness completion check: code changed without a later successful verification command, or the latest verification failed. Run the smallest relevant test, typecheck, lint, or build now. Do not give a final response until it passes; if no check exists, add or identify a concrete executable check.",
      });
      return false;
    }
    const results = report.evidence.map((item) => ({ ...item }));
    const evidence = results.length
      ? results.map(formatVerificationEvidence).join("; ")
      : "no code verification required";
    await this.append("verification.finished", {
      success: true,
      evidence,
      ...(results.length ? { results } : {}),
    });
    if (this.steeringVersion !== steeringAtStart) {
      return false;
    }
    const content = assistant.content || "Task completed";
    const summary =
      results.length && !results.every((item) => content.includes(item.command))
        ? `${content}\n\nVerification: ${evidence}`
        : content;
    await this.append("run.completed", {
      summary,
      verification: report.required ? "passed" : "not-required",
      ...(results.length ? { results } : {}),
    });
    return true;
  }

  private async hydrateImages(messages: RunState["messages"]): Promise<RunState["messages"]> {
    return Promise.all(
      messages.map(async (message) => {
        if (message.role !== "tool" || !message.images?.length) return message;
        const images = await Promise.all(
          message.images.map(async (image) => ({
            ...image,
            data: (await this.options.artifacts.read(this.runId, image.artifactId, 0, 1000))
              .content,
          })),
        );
        return { ...message, images };
      }),
    );
  }

  private async executeCall(call: ToolCall, signal: AbortSignal): Promise<void> {
    if (this.isBlocked()) return;
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

    let policy = this.options.policy.evaluate(
      tool,
      input,
      this.state.permissionMode,
      this.state.bypassPermissions,
    );
    if (this.state.dontAsk && policy.action === "ask") {
      policy = { ...policy, action: "deny", reason: `dontAsk denied: ${policy.reason}` };
    }
    if (policy.requiresReview) {
      policy = await this.reviewPolicy(call, tool, input, policy, signal);
      if (this.state.dontAsk && policy.action === "ask") {
        policy = { ...policy, action: "deny", reason: `dontAsk denied: ${policy.reason}` };
      }
    }
    if (policy.action === "deny") {
      await this.append("tool.decided", {
        callId: call.id,
        decision: "rejected",
        reason: policy.reason,
      });
      await this.recordError(call, policy.reason);
      if (this.scopeBlockedCallId === call.id) {
        await this.append("run.blocked", { reason: policy.reason });
      }
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
    if (tool.interaction === "user-input" && this.state.dontAsk) {
      await this.append("run.blocked", {
        reason: "User input is required, but dontAsk is enabled for this run",
      });
      return;
    }
    if (tool.interaction === "user-input") {
      await this.append("user_input.required", {
        callId: call.id,
        questions: (input as { questions: UserInputQuestion[] }).questions,
      });
    }
    try {
      this.throwIfCancelled(signal);
      const result = await tool.execute(input, {
        runId: this.runId,
        callId: call.id,
        cwd: this.state.cwd,
        signal,
        artifacts: this.options.artifacts,
        ...(this.options.userInput ? { userInput: this.options.userInput } : {}),
        ...(this.options.subagents ? { subagents: this.options.subagents } : {}),
        onOutput: (text) => this.options.observer?.onToolOutputDelta?.(this.runId, call.id, text),
        onSubagentStarted: async (childRunId) => {
          await this.append("subagent.started", {
            callId: call.id,
            childRunId,
            task: String((input as { task?: unknown }).task ?? ""),
          });
        },
        onSubagentFinished: async (result) => {
          await this.append("subagent.finished", {
            callId: call.id,
            childRunId: result.runId,
            status: result.status,
            summary: result.summary,
            ...(result.error ? { error: result.error } : {}),
          });
        },
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
          ...(result.verifications ? { verifications: result.verifications } : {}),
          ...(result.images ? { images: result.images } : {}),
          ...(result.execution ? { execution: result.execution } : {}),
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

  private async reviewPolicy(
    call: ToolCall,
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    input: unknown,
    policy: PolicyDecision,
    signal: AbortSignal,
  ): Promise<PolicyDecision> {
    if (this.state.dontAsk) return { ...policy, action: "deny" };
    if (!this.options.autoReview) {
      return { ...policy, action: "ask", reason: "Auto reviewer is not configured" };
    }
    await this.append("permission.review.started", { callId: call.id, tool: tool.name });
    try {
      const review = await this.options.autoReview.review(
        {
          ...reviewTask(this.state),
          tool,
          arguments: input,
          risk: policy.risk,
          projectTrusted: this.options.projectTrusted ?? false,
        },
        signal,
      );
      await this.append("permission.review.completed", {
        callId: call.id,
        action: review.action,
        category: review.category,
        reason: review.reason,
      });
      if (review.usage) {
        await this.append("model.usage", { iteration: this.iteration, ...review.usage });
      }
      if (review.action === "deny" && review.category === "out_of_scope") {
        const count = (this.scopeRejections.get(tool.name) ?? 0) + 1;
        this.scopeRejections.set(tool.name, count);
        const guidance =
          "Do not retry the same or an equivalent action without a new user instruction.";
        const reason = `${review.reason} ${guidance}`;
        if (count >= 3) {
          this.scopeBlockedCallId = call.id;
          return {
            ...policy,
            action: "deny",
            reason: `Auto review rejected ${tool.name} as out of scope ${count} times for the current task. ${reason}`,
          };
        }
        return { ...policy, action: "deny", reason };
      }
      this.scopeRejections.delete(tool.name);
      return { ...policy, action: review.action, reason: review.reason };
    } catch (error) {
      const message = errorMessage(error);
      await this.append("permission.review.failed", { callId: call.id, error: message });
      return { ...policy, action: "ask", reason: `Auto review failed: ${message}` };
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

function reviewTask(state: RunState): { task: string; originalTask?: string } {
  const latest = state.messages.findLast(
    (message) => message.role === "user" && message.source === "user" && message.content.trim(),
  );
  if (!latest || latest.content === state.task) return { task: state.task };
  return { task: latest.content, originalTask: state.task };
}
