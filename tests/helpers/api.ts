import { AgentApi, InProcessTransport } from "@fidoo/api";
import { createAgentClient } from "@fidoo/client";
import type { AssistantMessage, PermissionMode } from "@fidoo/core";
import {
  BASE_SYSTEM_PROMPT,
  PolicyEngine,
  RunService,
  ToolRegistry,
  updatePlanTool,
} from "@fidoo/core";
import {
  BackgroundTaskManager,
  createCodingTools,
  LocalWorkspace,
  MemoryArtifactStore,
  MemoryEventStore,
} from "@fidoo/node-runtime";
import { FakeModel } from "./fake-model.js";
import { approveAll } from "./runtime.js";

export function testApi(
  responses: AssistantMessage[],
  options: { permission?: PermissionMode } = {},
) {
  const store = new MemoryEventStore();
  const artifacts = new MemoryArtifactStore();
  const workspace = new LocalWorkspace();
  const tasks = new BackgroundTaskManager();
  const model = new FakeModel(responses);
  const api = new AgentApi({
    createRunService(observer, approval) {
      return new RunService({
        model,
        modelName: "fake-model",
        store,
        workspace,
        artifacts,
        tools: new ToolRegistry([updatePlanTool, ...createCodingTools(tasks)]),
        approval: approval ?? approveAll,
        policy: new PolicyEngine(options.permission ?? "auto"),
        systemPrompt: BASE_SYSTEM_PROMPT,
        maxIterations: 10,
        observer,
      });
    },
    eventStore: store,
    artifacts,
    workspace,
    tasks,
  });
  const client = createAgentClient(new InProcessTransport(api));
  return { api, client, store, artifacts, model, tasks };
}
