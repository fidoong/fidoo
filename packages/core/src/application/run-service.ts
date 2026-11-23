import { randomUUID } from "node:crypto";
import { AgentError } from "../domain/errors.js";
import type { AgentEvent, EventPayload, EventType } from "../domain/events.js";
import { createEvent } from "../domain/events.js";
import type { RunState } from "../domain/run-state.js";
import { replayRun } from "../domain/run-state.js";
import type { EventStore } from "../ports/event-store.js";
import type { WorkspacePort } from "../ports/workspace.js";
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
  ): Promise<RunState> {
    const root = await this.options.workspace.assertDirectory(cwd);
    const runId = requestedRunId ?? randomUUID();
    const events: AgentEvent[] = [];
    await this.append(events, runId, "run.started", { task, cwd: root });
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
    if (task) {
      const events = await this.options.store.load(runId);
      await this.append(events, runId, "run.resumed", { reason: "User continued the run" });
      await this.append(events, runId, "message.user", {
        message: { role: "user", source: "user", content: task },
      });
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

  async cancel(runId: string): Promise<RunState> {
    const events = await this.options.store.load(runId);
    const state = replayRun(runId, events);
    if (state.status === "running") {
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
