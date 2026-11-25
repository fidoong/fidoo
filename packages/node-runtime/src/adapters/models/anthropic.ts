import type { Message, ModelEvent, ModelPort, ModelRequest, ToolCall } from "@fidoo/core";
import { AgentError } from "@fidoo/core";
import { openProviderStream, readSse } from "./http.js";

export interface AnthropicOptions {
  apiKey: string;
  baseURL?: string;
}

interface PendingTool {
  id: string;
  name: string;
  arguments: string;
}

export class AnthropicModel implements ModelPort {
  private readonly baseURL: string;

  constructor(private readonly options: AnthropicOptions) {
    this.baseURL = (options.baseURL ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const response = await openProviderStream(
      `${this.baseURL}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 8192,
          system: request.cache
            ? [
                {
                  type: "text",
                  text: request.systemPrompt,
                  cache_control: { type: "ephemeral" },
                },
              ]
            : request.systemPrompt,
          messages: toAnthropicMessages(request),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
          stream: true,
        }),
      },
      signal,
    );

    let content = "";
    let reasoningContent = "";
    let usage:
      | {
          inputTokens: number;
          outputTokens: number;
          uncachedInputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
        }
      | undefined;
    const calls = new Map<number, PendingTool>();
    for await (const { data } of readSse(response)) {
      const event = json(data);
      if (event.type === "content_block_start") {
        const index = numeric(event.index);
        const block = object(event.content_block);
        if (block?.type === "tool_use" && index !== undefined) {
          calls.set(index, {
            id: text(block.id) ?? `call_${index + 1}`,
            name: text(block.name) ?? "",
            arguments:
              block.input && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : "",
          });
        }
      } else if (event.type === "content_block_delta") {
        const delta = object(event.delta);
        if (delta?.type === "text_delta") {
          const value = text(delta.text) ?? "";
          content += value;
          if (value) yield { type: "text.delta", text: value };
        } else if (delta?.type === "thinking_delta") {
          const value = text(delta.thinking) ?? "";
          reasoningContent += value;
          if (value) yield { type: "reasoning.delta", text: value };
        } else if (delta?.type === "input_json_delta") {
          const index = numeric(event.index);
          const call = index === undefined ? undefined : calls.get(index);
          if (call) call.arguments += text(delta.partial_json) ?? "";
        }
      } else if (event.type === "message_start") {
        const value = object(object(event.message)?.usage);
        const uncachedInputTokens = numeric(value?.input_tokens) ?? 0;
        const cacheReadTokens = numeric(value?.cache_read_input_tokens) ?? 0;
        const cacheWriteTokens = numeric(value?.cache_creation_input_tokens) ?? 0;
        usage = {
          inputTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
          outputTokens: numeric(value?.output_tokens) ?? 0,
          uncachedInputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
      } else if (event.type === "message_delta") {
        const delta = object(event.delta);
        if (delta?.stop_reason === "max_tokens") {
          throw new AgentError("Provider output reached the token limit", "provider", true);
        }
        const outputTokens = numeric(object(event.usage)?.output_tokens);
        if (usage && outputTokens !== undefined) usage.outputTokens = outputTokens;
      } else if (event.type === "error") {
        throw new AgentError(
          `Anthropic stream error: ${JSON.stringify(event.error)}`,
          "provider",
          true,
        );
      }
    }
    if (usage) yield { type: "usage", ...usage };
    const toolCalls: ToolCall[] = [...calls.values()].map((call) => ({
      ...call,
      arguments: call.arguments || "{}",
    }));
    yield {
      type: "message.completed",
      message: {
        role: "assistant",
        content,
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      },
    };
  }
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: unknown;
}

function toAnthropicMessages(request: ModelRequest): AnthropicMessage[] {
  const persistent: AnthropicMessage[] = request.messages.map(toAnthropicMessage);
  if (request.cache && persistent.length > 0) {
    const last = persistent.at(-1);
    if (last) persistent[persistent.length - 1] = withCacheBreakpoint(last);
  }
  return [...persistent, ...(request.runtimeMessages ?? []).map(toAnthropicMessage)];
}

function withCacheBreakpoint(message: AnthropicMessage): AnthropicMessage {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: [
        {
          type: "text",
          text: message.content,
          cache_control: { type: "ephemeral" },
        },
      ],
    };
  }
  if (Array.isArray(message.content) && message.content.length > 0) {
    const blocks = [...message.content];
    const last = blocks.at(-1);
    if (last && typeof last === "object") {
      blocks[blocks.length - 1] = {
        ...last,
        cache_control: { type: "ephemeral" },
      };
    }
    return { ...message, content: blocks };
  }
  return message;
}

function toAnthropicMessage(message: Message): AnthropicMessage {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.images?.length
            ? [
                { type: "text", text: message.content },
                ...message.images.map((image) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mimeType,
                    data: image.data ?? "",
                  },
                })),
              ]
            : message.content,
          is_error: message.isError,
        },
      ],
    };
  }
  return {
    role: "assistant",
    content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...(message.toolCalls ?? []).map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: parseArguments(call.arguments),
      })),
    ],
  };
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function json(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
