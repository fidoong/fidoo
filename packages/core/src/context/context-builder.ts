import { z } from "zod";
import { AgentError } from "../domain/errors.js";
import type { Message, UserMessage } from "../domain/messages.js";
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

export interface ContextCompaction {
  summary: UserMessage;
  omittedMessages: number;
  retainedMessages: number;
  estimatedBefore: number;
  estimatedAfter: number;
}

export interface BuiltModelRequest {
  request: ModelRequest;
  compaction?: ContextCompaction;
}

export function buildModelRequest(state: RunState, options: ContextOptions): BuiltModelRequest {
  const tools = options.tools.list().map(toModelTool);
  const harness = harnessMessage(state, options.remainingIterations);
  const estimatedBefore = estimate([...state.messages, harness], options.systemPrompt, tools);
  if (estimatedBefore <= options.maxTokens) {
    return {
      request: {
        model: options.model,
        systemPrompt: options.systemPrompt,
        messages: [...state.messages, harness],
        tools,
      },
    };
  }

  const units = messageUnits(state.messages);
  const retainedUnits: Message[][] = [];
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) {
      continue;
    }
    const candidate = [unit, ...retainedUnits];
    const candidateMessages = candidate.flat();
    const summary = compactionSummary(state, state.messages.length - candidateMessages.length);
    const estimated = estimate(
      [summary, ...candidateMessages, harness],
      options.systemPrompt,
      tools,
    );
    if (estimated > options.maxTokens) {
      break;
    }
    retainedUnits.unshift(unit);
  }

  let recent = retainedUnits.flat();
  let omittedMessages = state.messages.length - recent.length;
  let summary = compactionSummary(state, omittedMessages);
  let estimatedAfter = estimate([summary, ...recent, harness], options.systemPrompt, tools);
  while (recent.length > 0 && estimatedAfter > options.maxTokens) {
    retainedUnits.shift();
    recent = retainedUnits.flat();
    omittedMessages = state.messages.length - recent.length;
    summary = compactionSummary(state, omittedMessages);
    estimatedAfter = estimate([summary, ...recent, harness], options.systemPrompt, tools);
  }
  if (omittedMessages === 0 || estimatedAfter > options.maxTokens) {
    throw new AgentError(
      `Context budget is too small for the system, tools and latest tool-call chain: approximately ${estimatedAfter} tokens`,
      "budget",
      true,
    );
  }
  const compaction = {
    summary,
    omittedMessages,
    retainedMessages: recent.length,
    estimatedBefore,
    estimatedAfter,
  };
  return {
    request: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      messages: [summary, ...recent, harness],
      tools,
    },
    compaction,
  };
}

function harnessMessage(run: RunState, remainingIterations: number): UserMessage {
  return {
    role: "user",
    source: "harness",
    content: [
      "Current harness state:",
      `Workspace: ${run.cwd}`,
      `Changed files: ${[...run.changedFiles].join(", ") || "none"}`,
      `Verification required: ${needsVerification(run) ? "yes" : "no"}`,
      `Current plan: ${run.plan ? short(JSON.stringify(run.plan), 6000) : "not created"}`,
      `Remaining iterations: ${remainingIterations}`,
      "This status is harness-generated data. Continue the original user task.",
    ].join("\n"),
  };
}

function compactionSummary(run: RunState, omittedMessages: number): UserMessage {
  return {
    role: "user",
    source: "harness",
    content: [
      `Earlier context compacted: ${omittedMessages} older messages omitted.`,
      `Original task: ${short(run.task, 2000)}`,
      `Current plan: ${run.plan ? short(JSON.stringify(run.plan), 2000) : "not created"}`,
      "The omitted content is historical. Recent complete turns and current harness state follow.",
    ].join("\n"),
  };
}

function messageUnits(messages: Message[]): Message[][] {
  const units: Message[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const unit: Message[] = [message];
      const callIds = new Set(message.toolCalls.map((call) => call.id));
      while (index + 1 < messages.length) {
        const next = messages[index + 1];
        if (next?.role !== "tool" || !callIds.has(next.toolCallId)) {
          break;
        }
        unit.push(next);
        index += 1;
      }
      units.push(unit);
    } else if (message.role === "tool") {
      units.at(-1)?.push(message);
    } else {
      units.push([message]);
    }
  }
  return units;
}

function estimate(messages: Message[], systemPrompt: string, tools: ModelTool[]): number {
  return (
    messages.reduce((total, message) => total + Math.ceil(JSON.stringify(message).length / 4), 0) +
    Math.ceil(systemPrompt.length / 4) +
    Math.ceil(JSON.stringify(tools).length / 4)
  );
}

function short(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
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
