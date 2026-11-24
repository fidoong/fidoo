import { randomUUID } from "node:crypto";
import type {
  ApprovalPort,
  ArtifactStore,
  EventStore,
  RunService,
  RuntimeObserver,
  WorkspacePort,
} from "@fidoo/core";
import { AgentError, createEvent, errorMessage, replayRun } from "@fidoo/core";
import type {
  ApiMethod,
  BackgroundTask,
  BackgroundTaskEvent,
  ProviderModelsParams,
  ProviderSettings,
  PublicRunEvent,
  SettingsUpdateParams,
  SubscriptionMethod,
  TaskOutputPage,
} from "@fidoo/protocol";
import {
  approvalRespondParamsSchema,
  artifactReadParamsSchema,
  isTerminalRunEvent,
  isTransientRunEvent,
  runIdParamsSchema,
  runListParamsSchema,
  runResumeParamsSchema,
  runStartParamsSchema,
  runSteerParamsSchema,
  runSubscribeParamsSchema,
  taskListParamsSchema,
  taskOutputParamsSchema,
  taskStopParamsSchema,
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
  toToolOutputDelta,
} from "./event-mapper.js";
import { RequestResultCache } from "./request-result-cache.js";
import { RunCommandQueue } from "./run-command-queue.js";
import { TaskHub } from "./task-hub.js";

export interface AgentSettingsPort {
  getSettings(): ProviderSettings;
  updateSettings(params: SettingsUpdateParams): Promise<{
    settings: ProviderSettings;
    createRunService(observer: RuntimeObserver, approval: ApprovalPort): RunService;
  }>;
  listModels(params: ProviderModelsParams): Promise<{ models: string[]; unavailable?: boolean }>;
}

export interface AgentTaskPort {
  list(runId?: string): Promise<BackgroundTask[]>;
  stop(taskId: string): Promise<BackgroundTask>;
  readOutput(taskId: string, offset: number, limit: number): Promise<TaskOutputPage>;
  onEvent(listener: (event: BackgroundTaskEvent) => void): () => void;
}

export interface AgentApiOptions {
  createRunService(observer: RuntimeObserver, approval: ApprovalPort): RunService;
  eventStore: EventStore;
  artifacts: ArtifactStore;
  workspace: WorkspacePort;
  tasks?: AgentTaskPort;
  settings?: AgentSettingsPort;
}

export class AgentApi {
  private readonly hub = new EventHub();
  private readonly taskHub = new TaskHub();
  private readonly approval = new ApprovalBroker();
  private readonly commands = new RunCommandQueue();
  private readonly requestResults = new RequestResultCache();
  private runService: RunService;
  private readonly observer: RuntimeObserver;
  private readonly active = new Map<string, AbortController>();
  private readonly executions = new Map<string, Promise<unknown>>();

  constructor(private readonly options: AgentApiOptions) {
    this.observer = {
      onEvent: (event) => this.hub.publish(toPublicRunEvent(event)),
      onTextDelta: (text, runId) => {
        this.hub.publishTransient(toAssistantDelta(runId, this.hub.sequence(runId), text));
      },
      onReasoningDelta: (text, runId) => {
        this.hub.publishTransient(toReasoningDelta(runId, this.hub.sequence(runId), text));
      },
      onToolOutputDelta: (runId, callId, text) => {
        this.hub.publishTransient(toToolOutputDelta(runId, this.hub.sequence(runId), callId, text));
      },
    };
    this.runService = options.createRunService(this.observer, this.approval);
    this.options.tasks?.onEvent((event) => this.taskHub.publish(event));
  }

  async call(method: ApiMethod, params: unknown, requestId?: string): Promise<unknown> {
    switch (method) {
      case "workspace.validate":
        return this.validateWorkspace(params);
      case "run.start":
        return this.requestResults.run(method, requestId, params, () => this.start(params));
      case "run.resume":
        return this.requestResults.run(method, requestId, params, () => this.resume(params));
      case "run.steer":
        return this.requestResults.run(method, requestId, params, () => this.steer(params));
      case "run.cancel":
        return this.requestResults.run(method, requestId, params, () => this.cancel(params));
      case "run.get":
        return this.get(params);
      case "run.list":
        return this.list(params);
      case "run.trace":
        return this.trace(params);
      case "artifact.read":
        return this.readArtifact(params);
      case "settings.get":
        return this.getSettings();
      case "settings.update":
        return this.updateSettings(params);
      case "settings.models":
        return this.listModels(params);
      case "approval.respond":
        return this.requestResults.run(method, requestId, params, () => this.respond(params));
      case "task.list":
        return this.listTasks(params);
      case "task.output":
        return this.readTaskOutput(params);
      case "task.stop":
        return this.stopTask(params);
      case "run.subscribe":
      case "task.subscribe":
        throw new AgentError(`${method} must use the subscription transport`, "configuration");
      default:
        throw new AgentError(`Unknown API method: ${String(method)}`, "configuration");
    }
  }

  subscribe(method: SubscriptionMethod, params: unknown): AsyncIterable<unknown> {
    if (method === "task.subscribe") return this.taskHub.subscribe();
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
    this.assertConfigured();
    const input = runStartParamsSchema.parse(params);
    const runId = randomUUID();
    return this.commands.run(runId, async () => {
      await this.options.workspace.assertDirectory(input.cwd);
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
    });
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
    this.assertConfigured();
    const input = runResumeParamsSchema.parse(params);
    return this.commands.run(input.runId, async () => {
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
    });
  }

  private async steer(params: unknown) {
    const input = runSteerParamsSchema.parse(params);
    return this.commands.run(input.runId, async () => {
      if (!this.active.has(input.runId)) {
        throw new AgentError("Run is not active; resume it before steering", "configuration");
      }
      await this.runService.steer(input.runId, input.task);
      return { ok: true as const };
    });
  }

  private async cancel(params: unknown) {
    const input = runIdParamsSchema.parse(params);
    return this.commands.run(input.runId, async () => {
      const controller = this.active.get(input.runId);
      if (controller) {
        controller.abort();
        await this.executions.get(input.runId);
        return toPublicSnapshot(
          replayRun(input.runId, await this.options.eventStore.load(input.runId)),
        );
      }
      return toPublicSnapshot(await this.runService.cancel(input.runId));
    });
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

  private async readArtifact(params: unknown) {
    const input = artifactReadParamsSchema.parse(params);
    return this.options.artifacts.read(input.runId, input.artifactId, input.offset, input.limit);
  }

  private async listTasks(params: unknown) {
    const input = taskListParamsSchema.parse(params);
    return this.taskPort().list(input.runId);
  }

  private async readTaskOutput(params: unknown) {
    const input = taskOutputParamsSchema.parse(params);
    return this.taskPort().readOutput(input.taskId, input.offset, input.limit);
  }

  private async stopTask(params: unknown) {
    const input = taskStopParamsSchema.parse(params);
    return this.taskPort().stop(input.taskId);
  }

  private taskPort(): AgentTaskPort {
    if (!this.options.tasks) {
      throw new AgentError("Background tasks are not available", "configuration");
    }
    return this.options.tasks;
  }

  private respond(params: unknown) {
    const input = approvalRespondParamsSchema.parse(params);
    return this.commands.run(input.runId, () => {
      this.approval.respond(input);
      return { ok: true as const };
    });
  }

  private getSettings() {
    if (!this.options.settings) {
      throw new AgentError("Runtime settings are not available", "configuration");
    }
    return this.options.settings.getSettings();
  }

  private async updateSettings(params: unknown) {
    if (!this.options.settings) {
      throw new AgentError("Runtime settings are not available", "configuration");
    }
    if (this.active.size > 0) {
      throw new AgentError("Finish or cancel active runs before changing models", "configuration");
    }
    const result = await this.options.settings.updateSettings(params as SettingsUpdateParams);
    this.runService = result.createRunService(this.observer, this.approval);
    return result.settings;
  }

  private listModels(params: unknown) {
    if (!this.options.settings) {
      throw new AgentError("Runtime settings are not available", "configuration");
    }
    return this.options.settings.listModels(params as ProviderModelsParams);
  }

  private assertConfigured(): void {
    if (this.options.settings && !this.options.settings.getSettings().configured) {
      throw new AgentError("No model is configured. Run /setup in the TUI.", "configuration");
    }
  }
}
