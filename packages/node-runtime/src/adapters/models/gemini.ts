import type { Message, ModelEvent, ModelPort, ModelRequest, ToolCall } from "@fidoo/core";
import { AgentError } from "@fidoo/core";
import { openProviderStream, readSse } from "./http.js";

export interface GeminiOptions {
  apiKey: string;
  baseURL?: string;
}

export class GeminiModel implements ModelPort {
  private readonly baseURL: string;

  constructor(private readonly options: GeminiOptions) {
    this.baseURL = (options.baseURL ?? "https://generativelanguage.googleapis.com").replace(
      /\/$/,
      "",
    );
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const response = await openProviderStream(
      `${this.baseURL}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: request.messages.map(toGeminiContent),
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
          ...(request.maxTokens
            ? { generationConfig: { maxOutputTokens: request.maxTokens } }
            : {}),
        }),
      },
      signal,
    );

    let content = "";
    let reasoningContent = "";
    const toolCalls: ToolCall[] = [];
    for await (const { data } of readSse(response)) {
      const event = JSON.parse(data) as Record<string, unknown>;
      const usage = object(event.usageMetadata);
      if (usage) {
        const inputTokens = numeric(usage.promptTokenCount);
        const outputTokens = numeric(usage.candidatesTokenCount);
        yield {
          type: "usage",
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        };
      }
      const candidates = Array.isArray(event.candidates) ? event.candidates : [];
      const candidate = object(candidates[0]);
      if (candidate?.finishReason === "MAX_TOKENS") {
        throw new AgentError("Provider output reached the token limit", "provider", true);
      }
      const parts = object(candidate?.content)?.parts;
      for (const value of Array.isArray(parts) ? parts : []) {
        const part = object(value);
        if (!part) continue;
        const text = typeof part.text === "string" ? part.text : "";
        if (text && part.thought === true) {
          reasoningContent += text;
          yield { type: "reasoning.delta", text };
        } else if (text) {
          content += text;
          yield { type: "text.delta", text };
        }
        const call = object(part.functionCall);
        if (call) {
          toolCalls.push({
            id: `call_${toolCalls.length + 1}`,
            name: typeof call.name === "string" ? call.name : "",
            arguments: JSON.stringify(call.args ?? {}),
          });
        }
      }
    }
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

function toGeminiContent(message: Message) {
  if (message.role === "user") {
    return { role: "user", parts: [{ text: message.content }] };
  }
  if (message.role === "tool") {
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: message.name,
            response: { result: message.content, isError: message.isError },
          },
        },
      ],
    };
  }
  return {
    role: "model",
    parts: [
      ...(message.content ? [{ text: message.content }] : []),
      ...(message.toolCalls ?? []).map((call) => ({
        functionCall: { name: call.name, args: parseArguments(call.arguments) },
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
