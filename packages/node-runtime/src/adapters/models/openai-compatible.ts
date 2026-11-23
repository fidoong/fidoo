import type { Message, ModelEvent, ModelPort, ModelRequest, ToolCall } from "@fidoo/core";
import { AgentError, backoffDelay, withRetry } from "@fidoo/core";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseURL?: string;
  extraBody?: Record<string, unknown>;
  passReasoningContent?: boolean;
  timeoutMs?: number;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAICompatibleModel implements ModelPort {
  private readonly client: OpenAI;
  private readonly extraBody: Record<string, unknown>;
  private readonly passReasoningContent: boolean;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleOptions) {
    this.extraBody = options.extraBody ?? {};
    this.passReasoningContent = options.passReasoningContent ?? false;
    this.endpoint = safeEndpoint(options.baseURL ?? "https://api.openai.com/v1");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      maxRetries: 0,
      timeout: this.timeoutMs,
      defaultHeaders: { "User-Agent": "Fidoo/0.1.0" },
    });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    try {
      const stream = await withRetry(
        () =>
          this.client.chat.completions.create(
            {
              model: request.model,
              messages: toProviderMessages(request, this.passReasoningContent),
              tools: request.tools.map((tool) => ({
                type: "function" as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              stream: true,
              stream_options: { include_usage: true },
              ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
              ...this.extraBody,
            },
            { signal },
          ),
        {
          attempts: 3,
          signal,
          shouldRetry: isRetryableProviderError,
          delay: (_error, attempt) => backoffDelay(attempt),
        },
      );

      let content = "";
      let reasoningContent = "";
      const calls = new Map<number, PendingToolCall>();
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const reasoning = (choice?.delta as { reasoning_content?: string } | undefined)
          ?.reasoning_content;
        if (reasoning) {
          reasoningContent += reasoning;
          yield { type: "reasoning.delta", text: reasoning };
        }
        const text = choice?.delta.content;
        if (text) {
          content += text;
          yield { type: "text.delta", text };
        }
        for (const delta of choice?.delta.tool_calls ?? []) {
          const pending = calls.get(delta.index) ?? { id: "", name: "", arguments: "" };
          if (delta.id) {
            pending.id = delta.id;
          }
          if (delta.function?.name) {
            pending.name += delta.function.name;
          }
          if (delta.function?.arguments) {
            pending.arguments += delta.function.arguments;
          }
          calls.set(delta.index, pending);
        }
        if (choice?.finish_reason === "length") {
          throw new AgentError("Provider output reached the token limit", "provider", true);
        }
        if (chunk.usage) {
          yield {
            type: "usage",
            ...(chunk.usage.prompt_tokens !== undefined
              ? { inputTokens: chunk.usage.prompt_tokens }
              : {}),
            ...(chunk.usage.completion_tokens !== undefined
              ? { outputTokens: chunk.usage.completion_tokens }
              : {}),
          };
        }
      }

      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call], index) => ({
          id: call.id || `call_${index + 1}`,
          name: call.name,
          arguments: call.arguments || "{}",
        }));
      yield {
        type: "message.completed",
        message: {
          role: "assistant",
          content,
          ...(this.passReasoningContent ? { reasoningContent } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        },
      };
    } catch (error) {
      throw this.providerError(error, request.model);
    }
  }

  private providerError(error: unknown, model: string): unknown {
    const location = `Endpoint: ${this.endpoint}; model: ${model}`;
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new AgentError(
        `Provider request timed out after ${this.timeoutMs}ms. ${location}. Check the Base URL, network/proxy, and OpenAI-compatible streaming support.`,
        "provider",
        true,
      );
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return new AgentError(
        `Cannot connect to provider. ${location}. Check the Base URL and network/proxy.`,
        "provider",
        true,
      );
    }
    return error;
  }
}

function safeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "invalid Base URL";
  }
}

function toProviderMessages(
  request: ModelRequest,
  passReasoningContent: boolean,
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: request.systemPrompt },
    ...request.messages.map((message) => toProviderMessage(message, passReasoningContent)),
  ];
}

function toProviderMessage(
  message: Message,
  passReasoningContent: boolean,
): ChatCompletionMessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant": {
      const assistant: ChatCompletionMessageParam = {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
      return passReasoningContent
        ? ({
            ...assistant,
            reasoning_content: message.reasoningContent ?? "",
          } as ChatCompletionMessageParam)
        : assistant;
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return [408, 409, 429].includes(error.status) || error.status >= 500;
  }
  return error instanceof TypeError;
}
