import type { AssistantMessage, Message } from "../domain/messages.js";

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools: ModelTool[];
  maxTokens?: number;
}

export type ModelEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "message.completed"; message: AssistantMessage }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
    };

export interface ModelPort {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
