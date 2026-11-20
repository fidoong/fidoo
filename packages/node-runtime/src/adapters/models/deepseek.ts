import type { ModelEvent, ModelPort, ModelRequest } from "@fidoo/core";
import { OpenAICompatibleModel } from "./openai-compatible.js";

export type ThinkingMode = "enabled" | "disabled";
export type ReasoningEffort = "low" | "high" | "max";

export interface DeepSeekOptions {
  apiKey: string;
  baseURL?: string;
  thinking?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

export class DeepSeekModel implements ModelPort {
  private readonly model: OpenAICompatibleModel;

  constructor(options: DeepSeekOptions) {
    const thinking = options.thinking ?? "enabled";
    this.model = new OpenAICompatibleModel({
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? "https://api.deepseek.com",
      passReasoningContent: thinking === "enabled",
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      extraBody: {
        thinking: { type: thinking },
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      },
    });
  }

  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    return this.model.stream(request, signal);
  }
}
