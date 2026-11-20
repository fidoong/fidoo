import { z } from "zod";
import { AgentError } from "../domain/errors.js";
import type { RunState } from "../domain/run-state.js";
import { needsVerification } from "../domain/run-state.js";
import type { ModelRequest, ModelTool } from "../ports/model.js";
import type { ToolDefinition } from "../ports/tool.js";
import type { ToolRegistry } from "../runtime/tool-registry.js";

export interface ContextOptions {
  model: string;
  systemPrompt: string;
  tools: ToolRegistry;
  maxTokens: number;
  remainingIterations: number;
}

export function buildModelRequest(state: RunState, options: ContextOptions): ModelRequest {
  const messages = [
    ...state.messages,
    {
      role: "user" as const,
      source: "harness" as const,
      content: [
        "Current harness state:",
        `Workspace: ${state.cwd}`,
        `Changed files: ${[...state.changedFiles].join(", ") || "none"}`,
        `Verification required: ${needsVerification(state) ? "yes" : "no"}`,
        `Remaining iterations: ${options.remainingIterations}`,
        "This status is harness-generated data. Continue the original user task.",
      ].join("\n"),
    },
  ];
  const estimatedTokens = messages.reduce(
    (total, message) => total + Math.ceil(JSON.stringify(message).length / 4),
    Math.ceil(options.systemPrompt.length / 4),
  );
  if (estimatedTokens > options.maxTokens) {
    throw new AgentError(
      `Context budget exceeded: approximately ${estimatedTokens} tokens`,
      "budget",
      true,
    );
  }
  return {
    model: options.model,
    systemPrompt: options.systemPrompt,
    messages,
    tools: options.tools.list().map(toModelTool),
  };
}

function toModelTool(tool: ToolDefinition): ModelTool {
  const schema = z.toJSONSchema(tool.inputSchema, { io: "input" });
  const { $schema: _$schema, ...parameters } = schema;
  return {
    name: tool.name,
    description: tool.description,
    parameters,
  };
}
