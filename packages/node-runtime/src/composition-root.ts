import type {
  ApprovalPort,
  ArtifactStore,
  EventStore,
  PermissionMode,
  ResolvedPermissionPolicy,
  RunService,
  RuntimeObserver,
  WorkspacePort,
} from "@fidoo/core";
import {
  RunService as CoreRunService,
  loadProjectInstructions,
  PolicyEngine,
  ToolRegistry,
  updatePlanTool,
  withProjectInstructions,
} from "@fidoo/core";
import { RejectApproval } from "./adapters/approval/reject.js";
import { DeepSeekModel } from "./adapters/models/deepseek.js";
import { OpenAICompatibleModel } from "./adapters/models/openai-compatible.js";
import { loadPermissionPolicy } from "./adapters/policy/file-policy.js";
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
  permission: ResolvedPermissionPolicy;
  permissionMode: PermissionMode;
}

export async function createNodeRuntime(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
): Promise<NodeRuntime> {
  const instructions = await loadProjectInstructions(config.cwd);
  const permission = await loadPermissionPolicy(config);
  const permissionMode: PermissionMode = config.readOnly
    ? "read-only"
    : config.autoApprove
      ? "auto"
      : (permission.mode ?? "ask");
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
      tools: new ToolRegistry([updatePlanTool, ...createCodingTools()]),
      approval: serviceApproval ?? new RejectApproval(),
      policy: new PolicyEngine(permissionMode, permission.rules),
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
    permission,
    permissionMode,
  };
}

export async function createRunService(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
): Promise<RunService> {
  return (await createNodeRuntime(config, observer, approval)).runService;
}
