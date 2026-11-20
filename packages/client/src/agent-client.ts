import type {
  AgentTransport,
  ApprovalRespondParams,
  RunIdParams,
  RunListParams,
  RunResumeParams,
  RunStartParams,
  RunSubscribeParams,
  WorkspaceValidateParams,
} from "@fidoo/protocol";
import {
  apiResultSchema,
  publicRunEventSchema,
  runSnapshotSchema,
  runStartResultSchema,
  runSummarySchema,
  workspaceValidateResultSchema,
} from "@fidoo/protocol";
import { z } from "zod";

export class AgentClient {
  readonly workspace: WorkspaceClient;
  readonly run: RunClient;
  readonly approval: ApprovalClient;

  constructor(transport: AgentTransport) {
    this.workspace = new WorkspaceClient(transport);
    this.run = new RunClient(transport);
    this.approval = new ApprovalClient(transport);
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

class ApprovalClient {
  constructor(private readonly transport: AgentTransport) {}

  async respond(params: ApprovalRespondParams) {
    return apiResultSchema.parse(await this.transport.call("approval.respond", params));
  }
}
