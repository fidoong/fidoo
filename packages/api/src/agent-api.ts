import { randomUUID } from "node:crypto";
import type {
  ApprovalPort,
  EventStore,
  RunService,
  RuntimeObserver,
  WorkspacePort,
} from "@fidoo/core";
import { AgentError, createEvent, errorMessage, replayRun } from "@fidoo/core";
import type { ApiMethod, PublicRunEvent } from "@fidoo/protocol";
import {
  approvalRespondParamsSchema,
  isTerminalRunEvent,
  isTransientRunEvent,
  runIdParamsSchema,
  runListParamsSchema,
  runResumeParamsSchema,
  runStartParamsSchema,
  runSubscribeParamsSchema,
  workspaceValidateParamsSchema,
} from "@fidoo/protocol";
import { ApprovalBroker } from "./approval-broker.js";
import { EventHub, PublicEventStream } from "./event-hub.js";
import {
  toAssistantDelta,
  toPublicRunEvent,
  toPublicSnapshot,
  toPublicSummary,
  toReasoningDelta,
} from "./event-mapper.js";

export interface AgentApiOptions {
  createRunService(observer: RuntimeObserver, approval: ApprovalPort): RunService;
  eventStore: EventStore;
  workspace: WorkspacePort;
}

export class AgentApi {
  private readonly hub = new EventHub();
  private readonly approval = new ApprovalBroker();
  private readonly runService: RunService;
  private readonly active = new Map<string, AbortController>();
  private readonly executions = new Map<string, Promise<unknown>>();

  constructor(private readonly options: AgentApiOptions) {
    this.runService = options.createRunService(
      {
        onEvent: (event) => this.hub.publish(toPublicRunEvent(event)),
        onTextDelta: (text, runId) => {
          this.hub.publishTransient(toAssistantDelta(runId, this.hub.sequence(runId), text));
        },
        onReasoningDelta: (text, runId) => {
          this.hub.publishTransient(toReasoningDelta(runId, this.hub.sequence(runId), text));
        },
      },
      this.approval,
    );
  }

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case "workspace.validate":
        return this.validateWorkspace(params);
      case "run.start":
        return this.start(params);
      case "run.resume":
        return this.resume(params);
      case "run.cancel":
        return this.cancel(params);
      case "run.get":
        return this.get(params);
      case "run.list":
        return this.list(params);
      case "run.trace":
        return this.trace(params);
      case "approval.respond":
        return this.respond(params);
      case "run.subscribe":
        throw new AgentError("run.subscribe must use the subscription transport", "configuration");
      default:
        throw new AgentError(`Unknown API method: ${String(method)}`, "configuration");
    }
  }

  subscribe(params: unknown): AsyncIterable<unknown> {
    const input = runSubscribeParamsSchema.parse(params);
    const stream = new PublicEventStream();
    return {
      [Symbol.asyncIterator]: () => {
        const iterator = this.streamEvents(input.runId, input.afterSeq, stream)[
          Symbol.asyncIterator
        ]();
        return {
          next: () => iterator.next(),
          return: async (value?: unknown) => {
            stream.close();
            return iterator.return ? iterator.return(value) : { value, done: true };
          },
          throw: async (error?: unknown) => {
            stream.close();
            if (iterator.throw) {
              return iterator.throw(error);
            }
            throw error;
          },
        };
      },
    };
  }

  private async *streamEvents(
    runId: string,
    afterSeq: number,
    stream: PublicEventStream,
  ): AsyncIterable<unknown> {
    const buffered: PublicRunEvent[] = [];
    let replaying = true;
    const unsubscribe = this.hub.subscribe(runId, (event) => {
      if (replaying) {
        buffered.push(event);
      } else {
        stream.push(event);
      }
    });
    try {
      const events = await this.options.eventStore.load(runId);
      let lastSeq = afterSeq;
      for (const event of events) {
        if (event.seq > afterSeq) {
          const publicEvent = toPublicRunEvent(event);
          stream.push(publicEvent);
          lastSeq = Math.max(lastSeq, publicEvent.seq);
        }
      }
      replaying = false;
      for (const event of buffered) {
        if (isTransientRunEvent(event) || event.seq > lastSeq) {
          stream.push(event);
          if (!isTransientRunEvent(event)) {
            lastSeq = Math.max(lastSeq, event.seq);
          }
        }
      }
      for await (const event of stream) {
        yield event;
        if (isTerminalRunEvent(event)) {
          return;
        }
      }
    } finally {
      stream.close();
      unsubscribe();
    }
  }

  private async validateWorkspace(params: unknown) {
    const input = workspaceValidateParamsSchema.parse(params);
    try {
      return {
        path: await this.options.workspace.assertDirectory(input.cwd),
        valid: true as const,
      };
    } catch (error) {
      return {
        path: input.cwd,
        valid: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async start(params: unknown) {
    const input = runStartParamsSchema.parse(params);
    await this.options.workspace.assertDirectory(input.cwd);
    const runId = randomUUID();
    const controller = new AbortController();
    this.active.set(runId, controller);
    const execution = this.runService.start(input.task, input.cwd, controller.signal, runId);
    this.executions.set(runId, execution);
    void execution
      .catch(() => undefined)
      .finally(() => this.clearExecution(runId, controller, execution));
    await Promise.race([
      this.waitForRunStart(runId),
      execution.then(
        () => {
          throw new AgentError("Run ended before its start event was visible", "storage");
        },
        (error) => {
          throw error;
        },
      ),
    ]);
    return { runId };
  }

  private async recordBackgroundError(runId: string, error: unknown): Promise<void> {
    const events = await this.options.eventStore.load(runId);
    const state = replayRun(runId, events);
    if (state.status !== "running") {
      return;
    }
    const event = createEvent(
      {
        eventId: randomUUID(),
        runId,
        seq: events.length + 1,
        timestamp: new Date().toISOString(),
      },
      "run.failed",
      { error: errorMessage(error), recoverable: true },
    );
    await this.options.eventStore.append(event);
    this.hub.publish(toPublicRunEvent(event));
  }

  private waitForRunStart(runId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new AgentError(`Timed out waiting for run.started: ${runId}`, "storage"));
      }, 10_000);
      const unsubscribe = this.hub.subscribe(runId, (event) => {
        if (event.type === "run.started") {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private async resume(params: unknown) {
    const input = runResumeParamsSchema.parse(params);
    if (this.active.has(input.runId)) {
      throw new AgentError(`Run is already active: ${input.runId}`, "configuration");
    }
    const state = replayRun(input.runId, await this.options.eventStore.load(input.runId));
    await this.options.workspace.assertDirectory(state.cwd);
    const controller = new AbortController();
    this.active.set(input.runId, controller);
    const execution = this.runService.resume(input.runId, input.task, controller.signal);
    this.executions.set(input.runId, execution);
    void execution
      .catch((error) => this.recordBackgroundError(input.runId, error))
      .finally(() => this.clearExecution(input.runId, controller, execution));
    return { ok: true as const };
  }

  private async cancel(params: unknown) {
    const input = runIdParamsSchema.parse(params);
    const controller = this.active.get(input.runId);
    if (controller) {
      controller.abort();
      await this.executions.get(input.runId);
      return toPublicSnapshot(
        replayRun(input.runId, await this.options.eventStore.load(input.runId)),
      );
    }
    return toPublicSnapshot(await this.runService.cancel(input.runId));
  }

  private clearExecution(
    runId: string,
    controller: AbortController,
    execution: Promise<unknown>,
  ): void {
    if (this.active.get(runId) === controller && this.executions.get(runId) === execution) {
      this.active.delete(runId);
      this.executions.delete(runId);
    }
  }

  private async get(params: unknown) {
    const input = runIdParamsSchema.parse(params);
    return toPublicSnapshot(
      replayRun(input.runId, await this.options.eventStore.load(input.runId)),
    );
  }

  private async list(params: unknown) {
    const input = runListParamsSchema.parse(params);
    return (await this.options.eventStore.list()).slice(0, input.limit).map(toPublicSummary);
  }

  private async trace(params: unknown) {
    const input = runIdParamsSchema.parse(params);
    return (await this.options.eventStore.load(input.runId)).map(toPublicRunEvent);
  }

  private respond(params: unknown) {
    this.approval.respond(approvalRespondParamsSchema.parse(params));
    return { ok: true as const };
  }
}
