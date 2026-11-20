import { AgentApi, InProcessTransport } from "@fidoo/api";
import { createAgentClient } from "@fidoo/client";
import type { AssistantMessage, PermissionMode } from "@fidoo/core";
import { BASE_SYSTEM_PROMPT, PolicyEngine, RunService, ToolRegistry } from "@fidoo/core";
import {
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
  const model = new FakeModel(responses);
  const api = new AgentApi({
    createRunService(observer, approval) {
      return new RunService({
        model,
        modelName: "fake-model",
        store,
        workspace,
        artifacts,
        tools: new ToolRegistry(createCodingTools()),
        approval: approval ?? approveAll,
        policy: new PolicyEngine(options.permission ?? "auto"),
        systemPrompt: BASE_SYSTEM_PROMPT,
        maxIterations: 10,
        observer,
      });
    },
    eventStore: store,
    workspace,
  });
  const client = createAgentClient(new InProcessTransport(api));
  return { api, client, store, artifacts, model };
}
