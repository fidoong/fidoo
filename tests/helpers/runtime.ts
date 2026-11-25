import type {
  ApprovalPort,
  AssistantMessage,
  PermissionMode,
  RequiredCheck,
  UserInputPort,
} from "@fidoo/core";
import {
  BASE_SYSTEM_PROMPT,
  PolicyEngine,
  RunService,
  requestUserInputTool,
  ToolRegistry,
  updatePlanTool,
} from "@fidoo/core";
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
    requiredChecks?: RequiredCheck[];
    userInput?: UserInputPort;
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
    tools: new ToolRegistry([
      updatePlanTool,
      requestUserInputTool,
      ...createCodingTools(undefined, options.requiredChecks),
    ]),
    approval: options.approval ?? approveAll,
    ...(options.userInput ? { userInput: options.userInput } : {}),
    policy: new PolicyEngine(options.permission ?? "auto"),
    systemPrompt: BASE_SYSTEM_PROMPT,
    ...(options.requiredChecks ? { requiredChecks: options.requiredChecks } : {}),
    maxIterations: 10,
  });
  return { service, store, artifacts, model };
}
