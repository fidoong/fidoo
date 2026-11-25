import { createHash } from "node:crypto";
import type {
  ApprovalPort,
  ArtifactStore,
  EventStore,
  ModelPort,
  PermissionMode,
  ResolvedPermissionPolicy,
  RunService,
  RuntimeObserver,
  UserInputPort,
  WorkspacePort,
} from "@fidoo/core";
import {
  AgentError,
  RunService as CoreRunService,
  delegateTaskTool,
  loadProjectInstructions,
  ModelAutoReviewer,
  PolicyEngine,
  requestUserInputTool,
  ToolRegistry,
  updatePlanTool,
  withProjectInstructions,
} from "@fidoo/core";
import { modelContextBudget, providerDefinition } from "@fidoo/protocol";
import { RejectApproval } from "./adapters/approval/reject.js";
import { WorkspaceChangeManager } from "./adapters/changes/workspace-change-manager.js";
import {
  CommandExecutor,
  detectSandboxInstallation,
} from "./adapters/execution/command-executor.js";
import { loadExecutionConfig } from "./adapters/execution/config.js";
import type { ExecutionConfig } from "./adapters/execution/types.js";
import { AnthropicModel } from "./adapters/models/anthropic.js";
import { DeepSeekModel } from "./adapters/models/deepseek.js";
import { GeminiModel } from "./adapters/models/gemini.js";
import { OpenAICompatibleModel } from "./adapters/models/openai-compatible.js";
import { UnavailableModel } from "./adapters/models/unavailable.js";
import { loadPermissionPolicy } from "./adapters/policy/file-policy.js";
import { FileArtifactStore } from "./adapters/storage/file-artifact-store.js";
import { FileEventStore } from "./adapters/storage/file-event-store.js";
import { RunServiceSubagent } from "./adapters/subagents/run-service-subagent.js";
import { LocalWorkspace } from "./adapters/system/local-workspace.js";
import { BackgroundTaskManager } from "./adapters/tasks/background-task-manager.js";
import { createCodingTools } from "./adapters/tools/registry.js";
import { loadWebSearchConfig } from "./adapters/web/config.js";
import { createWebTools } from "./adapters/web/tools.js";
import type { NodeRuntimeConfig } from "./config.js";
import { loadRequiredChecks } from "./project-verification.js";

export interface NodeRuntime {
  runService: RunService;
  createRunService(
    observer?: RuntimeObserver,
    approval?: ApprovalPort,
    userInput?: UserInputPort,
  ): RunService;
  eventStore: EventStore;
  artifacts: ArtifactStore;
  workspace: WorkspacePort;
  tasks: BackgroundTaskManager;
  permission: ResolvedPermissionPolicy;
  permissionMode: PermissionMode;
  execution: ExecutionConfig;
}

export async function createNodeRuntime(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
  taskManager?: BackgroundTaskManager,
): Promise<NodeRuntime> {
  const instructions = await loadProjectInstructions(config.cwd);
  const requiredChecks = await loadRequiredChecks(config.cwd);
  const webSearch = await loadWebSearchConfig(config.cwd);
  const execution = await loadExecutionConfig(config.dataHome, config.sandbox);
  const executor = new CommandExecutor(execution, config.dataHome);
  const permission = await loadPermissionPolicy(config);
  const permissionMode: PermissionMode = config.readOnly
    ? "read-only"
    : (config.mode ?? permission.mode ?? "manual");
  if (config.bypassPermissions && (config.readOnly || permissionMode === "plan")) {
    throw new AgentError(
      "Bypass permissions cannot be combined with read-only or plan mode",
      "configuration",
    );
  }
  if (config.bypassPermissions && execution.mode !== "required") {
    throw new AgentError("Bypass permissions requires execution.mode=required", "configuration");
  }
  if (config.bypassPermissions && !(await detectSandboxInstallation())) {
    throw new AgentError("Bypass permissions requires an available OS sandbox", "configuration");
  }
  const autoReview = new ModelAutoReviewer(createModel(config), config.model);
  const eventStore = new FileEventStore(config.dataHome);
  const artifacts = new FileArtifactStore(config.dataHome);
  const workspace = new LocalWorkspace();
  const tasks = taskManager ?? new BackgroundTaskManager(config.dataHome, executor);
  const changes = new WorkspaceChangeManager(config.dataHome);
  const contextBudget = modelContextBudget(config.provider, config.model, config.maxContextTokens);
  const cacheKey =
    config.provider === "openai"
      ? `fidoo:v1:${createHash("sha256").update(`${config.cwd}\0${config.model}`).digest("hex").slice(0, 32)}`
      : undefined;
  const subagents = new RunServiceSubagent({
    model: createModel(config),
    modelName: config.model,
    store: eventStore,
    workspace,
    artifacts,
    tools: new ToolRegistry(
      createCodingTools(tasks, requiredChecks, changes, executor).filter(
        (tool) => tool.effect === "read",
      ),
    ),
    approval: new RejectApproval(),
    policy: new PolicyEngine("read-only"),
    permissionMode: "read-only",
    systemPrompt: `${withProjectInstructions(instructions)}\n\nYou are a read-only research subagent. Inspect the workspace and return concrete findings to the parent. Do not attempt writes, commands, user questions or nested delegation.`,
    ...(cacheKey ? { cacheKey } : {}),
    maxIterations: Math.min(config.maxIterations, 12),
    maxContextTokens: contextBudget,
  });
  const createService = (
    serviceObserver?: RuntimeObserver,
    serviceApproval?: ApprovalPort,
    userInput?: UserInputPort,
  ) =>
    new CoreRunService({
      model: createModel(config),
      modelName: config.model,
      store: eventStore,
      workspace,
      artifacts,
      tools: new ToolRegistry([
        updatePlanTool,
        requestUserInputTool,
        delegateTaskTool,
        ...createCodingTools(tasks, requiredChecks, changes, executor),
        ...createWebTools(webSearch),
      ]),
      approval: serviceApproval ?? new RejectApproval(),
      ...(userInput ? { userInput } : {}),
      subagents,
      policy: new PolicyEngine(permissionMode, permission.rules),
      permissionMode,
      dontAsk: config.dontAsk ?? false,
      bypassPermissions: config.bypassPermissions ?? false,
      autoReview,
      systemPrompt: withProjectInstructions(instructions, requiredChecks),
      ...(cacheKey ? { cacheKey } : {}),
      requiredChecks,
      maxIterations: config.maxIterations,
      maxContextTokens: contextBudget,
      ...(serviceObserver ? { observer: serviceObserver } : {}),
    });
  return {
    runService: createService(observer, approval),
    createRunService: createService,
    eventStore,
    artifacts,
    workspace,
    tasks,
    permission,
    permissionMode,
    execution,
  };
}

function createModel(config: NodeRuntimeConfig): ModelPort {
  const definition = providerDefinition(config.provider);
  if (!config.model || (definition.apiKeyRequired && !config.apiKey)) {
    return new UnavailableModel();
  }
  if (definition.protocol === "anthropic") {
    return new AnthropicModel({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }
  if (definition.protocol === "gemini") {
    return new GeminiModel({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }
  if (config.provider === "deepseek") {
    return new DeepSeekModel({
      apiKey: config.apiKey,
      thinking: config.thinking,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }
  return new OpenAICompatibleModel({
    apiKey: config.apiKey || "not-required",
    promptCacheKey: config.provider === "openai",
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

export async function createRunService(
  config: NodeRuntimeConfig,
  observer?: RuntimeObserver,
  approval?: ApprovalPort,
): Promise<RunService> {
  return (await createNodeRuntime(config, observer, approval)).runService;
}
