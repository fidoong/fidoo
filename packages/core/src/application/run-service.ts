import { randomUUID } from "node:crypto";
import { AgentError } from "../domain/errors.js";
import type { AgentEvent, EventPayload, EventType } from "../domain/events.js";
import { createEvent } from "../domain/events.js";
import type { RunOrigin } from "../domain/run-origin.js";
import type { RunState } from "../domain/run-state.js";
import { replayRun } from "../domain/run-state.js";
import type { EventStore } from "../ports/event-store.js";
import type { ToolDefinition } from "../ports/tool.js";
import type { WorkspacePort } from "../ports/workspace.js";
import type { PermissionMode, PolicyDecision } from "../runtime/policy-engine.js";
import type { AgentLoopOptions } from "./agent-loop.js";
import { AgentLoop } from "./agent-loop.js";

export type RunServiceOptions = Omit<AgentLoopOptions, "store"> & {
  store: EventStore;
  workspace: WorkspacePort;
};

export class RunService {
  private readonly activeLoops = new Map<string, AgentLoop>();

  constructor(private readonly options: RunServiceOptions) {}

  async start(
    task: string,
    cwd: string,
    signal: AbortSignal,
    requestedRunId?: string,
    permissionMode?: PermissionMode,
    origin?: RunOrigin,
  ): Promise<RunState> {
    const root = await this.options.workspace.assertDirectory(cwd);
    const runId = requestedRunId ?? randomUUID();
    const events: AgentEvent[] = [];
    await this.append(events, runId, "run.started", {
      task,
      cwd: root,
      ...(origin ? { origin } : {}),
      permissionMode:
        this.options.permissionMode === "read-only"
          ? "read-only"
          : (permissionMode ?? this.options.permissionMode ?? "manual"),
      dontAsk: this.options.dontAsk ?? false,
      bypassPermissions: this.options.bypassPermissions ?? false,
    });
    await this.append(events, runId, "message.user", {
      message: { role: "user", source: "user", content: task },
    });
    const loop = await AgentLoop.create(runId, this.options);
    return this.executeLoop(runId, loop, signal);
  }

  async resume(runId: string, task: string | undefined, signal: AbortSignal): Promise<RunState> {
    const existing = replayRun(runId, await this.options.store.load(runId));
    await this.options.workspace.assertDirectory(existing.cwd);
    await this.reconcileInterruptedCalls(runId);
    if (task || existing.status === "awaiting_plan") {
      const events = await this.options.store.load(runId);
      await this.append(events, runId, "run.resumed", { reason: "User continued the run" });
      if (task) {
        await this.append(events, runId, "message.user", {
          message: { role: "user", source: "user", content: task },
        });
      }
    }
    const loop = await AgentLoop.create(runId, this.options);
    return this.executeLoop(runId, loop, signal);
  }

  async steer(runId: string, task: string): Promise<void> {
    const loop = this.activeLoops.get(runId);
    if (!loop) {
      throw new AgentError("Run is not active; resume it before steering", "configuration");
    }
    await loop.steer(task);
  }

  async setMode(runId: string, mode: PermissionMode): Promise<RunState> {
    const state = replayRun(runId, await this.options.store.load(runId));
    if (state.permissionMode === "read-only") {
      throw new AgentError("Read-only mode cannot be changed during a run", "configuration");
    }
    const loop = this.activeLoops.get(runId);
    if (loop) {
      await loop.setMode(mode);
    } else if (state.permissionMode !== mode) {
      const events = await this.options.store.load(runId);
      await this.append(events, runId, "mode.changed", {
        mode,
        reason: "Mode changed through API",
      });
    }
    return replayRun(runId, await this.options.store.load(runId));
  }

  async decidePlan(
    runId: string,
    decision: "approved" | "rejected",
    mode: "manual" | "acceptEdits" | "auto",
    revision: number,
    feedback?: string,
  ): Promise<RunState> {
    const state = replayRun(runId, await this.options.store.load(runId));
    if (state.status !== "awaiting_plan" || !state.plan) {
      throw new AgentError("No plan is awaiting approval for this run", "configuration");
    }
    if (state.plan.revision !== revision) {
      throw new AgentError(
        "Plan is stale; review the latest revision before approving",
        "approval",
      );
    }
    const planId = state.plan.id;
    const events = await this.options.store.load(runId);
    if (decision === "approved") {
      await this.append(events, runId, "plan.approved", {
        planId,
        mode,
        ...(feedback ? { feedback } : {}),
      });
      await this.append(events, runId, "mode.changed", {
        mode,
        reason: "Plan approved",
      });
      await this.append(events, runId, "message.user", {
        message: {
          role: "user",
          source: "harness",
          content: `The plan was approved. Execute it in ${mode} mode.${feedback ? ` User feedback: ${feedback}` : ""}`,
        },
      });
    } else {
      await this.append(events, runId, "plan.rejected", {
        planId,
        ...(feedback ? { feedback } : {}),
      });
      await this.append(events, runId, "message.user", {
        message: {
          role: "user",
          source: "user",
          content: feedback?.trim()
            ? `Revise the plan without modifying files: ${feedback.trim()}`
            : "Revise the plan without modifying files.",
        },
      });
    }
    return replayRun(runId, await this.options.store.load(runId));
  }

  private async executeLoop(
    runId: string,
    loop: AgentLoop,
    signal: AbortSignal,
  ): Promise<RunState> {
    this.activeLoops.set(runId, loop);
    try {
      return await loop.run(signal);
    } finally {
      if (this.activeLoops.get(runId) === loop) {
        this.activeLoops.delete(runId);
      }
    }
  }

  async evaluateAction(
    runId: string,
    tool: ToolDefinition,
    input: unknown,
  ): Promise<PolicyDecision> {
    const state = replayRun(runId, await this.options.store.load(runId));
    const decision = this.options.policy.evaluate(
      tool,
      input,
      state.permissionMode,
      state.bypassPermissions,
    );
    if (state.dontAsk && decision.action === "ask") {
      return { ...decision, action: "deny", reason: `dontAsk denied: ${decision.reason}` };
    }
    return decision;
  }

  async cancel(runId: string): Promise<RunState> {
    const events = await this.options.store.load(runId);
    const state = replayRun(runId, events);
    if (state.status === "running" || state.status === "awaiting_plan") {
      await this.append(events, runId, "run.cancelled", {
        reason: "Cancelled through CLI; active processes must be interrupted in their own terminal",
      });
    }
    return replayRun(runId, await this.options.store.load(runId));
  }

  private async reconcileInterruptedCalls(runId: string): Promise<void> {
    const events = await this.options.store.load(runId);
    const state = replayRun(runId, events);
    if (state.status !== "running") {
      return;
    }
    for (const call of state.calls.values()) {
      if (state.results.has(call.id)) {
        continue;
      }
      await this.append(events, runId, "tool.result", {
        result: {
          callId: call.id,
          name: call.name,
          status: "error",
          content: JSON.stringify({
            error:
              "The previous process stopped before a tool result was recorded. Inspect the workspace and reconcile the actual state before choosing a new action; the call was not replayed automatically.",
            callId: call.id,
          }),
        },
      });
    }
  }

  private async append<Type extends EventType>(
    events: AgentEvent[],
    runId: string,
    type: Type,
    payload: EventPayload<Type>,
  ): Promise<void> {
    const event = createEvent(
      {
        eventId: randomUUID(),
        runId,
        seq: events.length + 1,
        timestamp: new Date().toISOString(),
      },
      type,
      payload,
    );
    await this.options.store.append(event);
    events.push(event);
    await this.options.observer?.onEvent?.(event);
  }
}

export function assertRunActive(state: RunState): void {
  if (state.status === "failed" || state.status === "blocked") {
    throw new AgentError(state.error ?? "Run did not complete", "verification", true);
  }
}
