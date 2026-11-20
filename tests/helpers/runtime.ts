import type { ApprovalPort, AssistantMessage, PermissionMode } from "@fidoo/core";
import { BASE_SYSTEM_PROMPT, PolicyEngine, RunService, ToolRegistry } from "@fidoo/core";
import {
  createCodingTools,
  LocalWorkspace,
  MemoryArtifactStore,
  MemoryEventStore,
} from "@fidoo/node-runtime";
import { FakeModel } from "./fake-model.js";

export const approveAll: ApprovalPort = {
  async approve() {
    return { approved: true, reason: "Test approval" };
  },
};

export const rejectAll: ApprovalPort = {
  async approve() {
    return { approved: false, reason: "Test rejection" };
  },
};

export function testRuntime(
  responses: AssistantMessage[],
  options: {
    permission?: PermissionMode;
    approval?: ApprovalPort;
    usage?: { inputTokens: number; outputTokens: number };
  } = {},
) {
  const store = new MemoryEventStore();
  const artifacts = new MemoryArtifactStore();
  const model = new FakeModel(responses, options.usage);
  const service = new RunService({
    model,
    modelName: "fake-model",
    store,
    workspace: new LocalWorkspace(),
    artifacts,
    tools: new ToolRegistry(createCodingTools()),
    approval: options.approval ?? approveAll,
    policy: new PolicyEngine(options.permission ?? "auto"),
    systemPrompt: BASE_SYSTEM_PROMPT,
    maxIterations: 10,
  });
  return { service, store, artifacts, model };
}
