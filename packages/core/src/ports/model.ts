import type { AssistantMessage, Message } from "../domain/messages.js";

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelCacheHints {
  key?: string;
  staticPrefixHash: string;
  conversationPrefixHash: string;
  requestHash: string;
}

export interface ModelRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  runtimeMessages?: Message[];
  tools: ModelTool[];
  cache?: ModelCacheHints;
  maxTokens?: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type ModelEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "message.completed"; message: AssistantMessage }
  | ({ type: "usage" } & ModelUsage);

export interface ModelPort {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
