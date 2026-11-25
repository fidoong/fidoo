import type {
  AgentConnectionState,
  AgentTransport,
  ApprovalRespondParams,
  ArtifactReadParams,
  BackgroundTaskEvent,
  InputRespondParams,
  ModeSetParams,
  PlanRespondParams,
  ProviderModelsParams,
  RunIdParams,
  RunListParams,
  RunResumeParams,
  RunStartParams,
  RunSteerParams,
  RunSubscribeParams,
  SettingsUpdateParams,
  TaskListParams,
  TaskOutputParams,
  TaskStopParams,
  WorkspaceValidateParams,
} from "@fidoo/protocol";
import {
  apiResultSchema,
  artifactPageSchema,
  backgroundTaskEventSchema,
  backgroundTaskSchema,
  permissionModeSchema,
  providerModelsResultSchema,
  providerSettingsSchema,
  publicRunEventSchema,
  runSnapshotSchema,
  runStartResultSchema,
  runSummarySchema,
  taskOutputPageSchema,
  workspaceValidateResultSchema,
} from "@fidoo/protocol";
import { z } from "zod";

export class AgentClient {
  readonly workspace: WorkspaceClient;
  readonly run: RunClient;
  readonly artifacts: ArtifactClient;
  readonly approval: ApprovalClient;
  readonly mode: ModeClient;
  readonly plan: PlanClient;
  readonly input: UserInputClient;
  readonly settings: SettingsClient;
  readonly tasks: TaskClient;

  constructor(private readonly transport: AgentTransport) {
    this.workspace = new WorkspaceClient(transport);
    this.run = new RunClient(transport);
    this.artifacts = new ArtifactClient(transport);
    this.approval = new ApprovalClient(transport);
    this.mode = new ModeClient(transport);
    this.plan = new PlanClient(transport);
    this.input = new UserInputClient(transport);
    this.settings = new SettingsClient(transport);
    this.tasks = new TaskClient(transport);
  }

  onConnectionChange(listener: (state: AgentConnectionState) => void): () => void {
    return this.transport.onConnectionChange?.(listener) ?? (() => undefined);
  }
}

export function createAgentClient(transport: AgentTransport): AgentClient {
  return new AgentClient(transport);
}

class WorkspaceClient {
  constructor(private readonly transport: AgentTransport) {}

  async validate(params: WorkspaceValidateParams) {
    return workspaceValidateResultSchema.parse(
      await this.transport.call("workspace.validate", params),
    );
  }
}

class RunClient {
  constructor(private readonly transport: AgentTransport) {}

  async start(params: RunStartParams) {
    return runStartResultSchema.parse(await this.transport.call("run.start", params));
  }

  async resume(params: RunResumeParams) {
    return apiResultSchema.parse(await this.transport.call("run.resume", params));
  }

  async steer(params: RunSteerParams) {
    return apiResultSchema.parse(await this.transport.call("run.steer", params));
  }

  async cancel(params: RunIdParams) {
    return runSnapshotSchema.parse(await this.transport.call("run.cancel", params));
  }

  async get(params: RunIdParams) {
    return runSnapshotSchema.parse(await this.transport.call("run.get", params));
  }

  async list(params: RunListParams = { limit: 50 }) {
    return z.array(runSummarySchema).parse(await this.transport.call("run.list", params));
  }

  async trace(params: RunIdParams) {
    return z.array(publicRunEventSchema).parse(await this.transport.call("run.trace", params));
  }

  async *subscribe(params: RunSubscribeParams) {
    for await (const event of this.transport.subscribe("run.subscribe", params)) {
      yield publicRunEventSchema.parse(event);
    }
  }
}

class ArtifactClient {
  constructor(private readonly transport: AgentTransport) {}

  async read(params: ArtifactReadParams) {
    return artifactPageSchema.parse(await this.transport.call("artifact.read", params));
  }
}

class SettingsClient {
  constructor(private readonly transport: AgentTransport) {}

  async get() {
    return providerSettingsSchema.parse(await this.transport.call("settings.get", {}));
  }

  async update(params: SettingsUpdateParams) {
    return providerSettingsSchema.parse(await this.transport.call("settings.update", params));
  }

  async listModels(params: ProviderModelsParams) {
    return providerModelsResultSchema.parse(await this.transport.call("settings.models", params));
  }
}

class TaskClient {
  constructor(private readonly transport: AgentTransport) {}

  async list(params: TaskListParams = {}) {
    return z.array(backgroundTaskSchema).parse(await this.transport.call("task.list", params));
  }

  async output(params: TaskOutputParams) {
    return taskOutputPageSchema.parse(await this.transport.call("task.output", params));
  }

  async stop(params: TaskStopParams) {
    return backgroundTaskSchema.parse(await this.transport.call("task.stop", params));
  }

  async *subscribe(): AsyncIterable<BackgroundTaskEvent> {
    for await (const event of this.transport.subscribe("task.subscribe", {})) {
      yield backgroundTaskEventSchema.parse(event);
    }
  }
}

class ModeClient {
  constructor(private readonly transport: AgentTransport) {}

  async get(params: RunIdParams) {
    return z
      .object({ mode: permissionModeSchema })
      .parse(await this.transport.call("mode.get", params));
  }

  async set(params: ModeSetParams) {
    return z
      .object({ mode: permissionModeSchema })
      .parse(await this.transport.call("mode.set", params));
  }
}

class PlanClient {
  constructor(private readonly transport: AgentTransport) {}

  async respond(params: PlanRespondParams) {
    return apiResultSchema.parse(await this.transport.call("plan.respond", params));
  }
}

class UserInputClient {
  constructor(private readonly transport: AgentTransport) {}

  async respond(params: InputRespondParams) {
    return apiResultSchema.parse(await this.transport.call("input.respond", params));
  }
}

class ApprovalClient {
  constructor(private readonly transport: AgentTransport) {}

  async respond(params: ApprovalRespondParams) {
    return apiResultSchema.parse(await this.transport.call("approval.respond", params));
  }
}
