import type {
  ApprovalPort,
  ArtifactStore,
  EventStore,
  RunService,
  RuntimeObserver,
  WorkspacePort,
} from "@fidoo/core";
import {
  RunService as CoreRunService,
  loadProjectInstructions,
  PolicyEngine,
  ToolRegistry,
  withProjectInstructions,
} from "@fidoo/core";
import { RejectApproval } from "./adapters/approval/reject.js";
import { DeepSeekModel } from "./adapters/models/deepseek.js";
import { OpenAICompatibleModel } from "./adapters/models/openai-compatible.js";
import { FileArtifactStore } from "./adapters/storage/file-artifact-store.js";
import { FileEventStore } from "./adapters/storage/file-event-store.js";
import { LocalWorkspace } from "./adapters/system/local-workspace.js";
import { createCodingTools } from "./adapters/tools/registry.js";
import type { NodeRuntimeConfig } from "./config.js";

export interface NodeRuntime {
  runService: RunService;
  createRunService(observer?: RuntimeObserver, approval?: ApprovalPort): RunService;
  eventStore: EventStore;
  artifacts: ArtifactStore;
  workspace: WorkspacePort;
}

export async function createNodeRuntime(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
): Promise<NodeRuntime> {
  const instructions = await loadProjectInstructions(config.cwd);
  const eventStore = new FileEventStore(config.dataHome);
  const artifacts = new FileArtifactStore(config.dataHome);
  const workspace = new LocalWorkspace();
  const createService = (serviceObserver?: RuntimeObserver, serviceApproval?: ApprovalPort) =>
    new CoreRunService({
      model:
        config.provider === "deepseek"
          ? new DeepSeekModel({
              apiKey: config.apiKey,
              thinking: config.thinking,
              ...(config.baseURL ? { baseURL: config.baseURL } : {}),
            })
          : new OpenAICompatibleModel({
              apiKey: config.apiKey,
              ...(config.baseURL ? { baseURL: config.baseURL } : {}),
            }),
      modelName: config.model,
      store: eventStore,
      workspace,
      artifacts,
      tools: new ToolRegistry(createCodingTools()),
      approval: serviceApproval ?? new RejectApproval(),
      policy: new PolicyEngine(config.readOnly ? "read-only" : config.autoApprove ? "auto" : "ask"),
      systemPrompt: withProjectInstructions(instructions),
      maxIterations: config.maxIterations,
      ...(serviceObserver ? { observer: serviceObserver } : {}),
    });
  return {
    runService: createService(observer, approval),
    createRunService: createService,
    eventStore,
    artifacts,
    workspace,
  };
}

export async function createRunService(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
): Promise<RunService> {
  return (await createNodeRuntime(config, observer, approval)).runService;
}
