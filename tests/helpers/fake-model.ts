import type { AssistantMessage, ModelEvent, ModelPort, ModelRequest } from "@fidoo/core";

export class FakeModel implements ModelPort {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly responses: AssistantMessage[],
    private readonly usage?: { inputTokens: number; outputTokens: number },
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    const response = this.responses[this.index++];
    if (!response) {
      throw new Error(`No scripted response for request ${this.index}`);
    }
    if (this.usage) {
      yield { type: "usage", ...this.usage };
    }
    if (response.reasoningContent) {
      yield { type: "reasoning.delta", text: response.reasoningContent };
    }
    if (response.content) {
      yield { type: "text.delta", text: response.content };
    }
    yield { type: "message.completed", message: structuredClone(response) };
  }
}

export function assistant(
  content: string,
  toolCalls?: AssistantMessage["toolCalls"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    ...(toolCalls ? { toolCalls } : {}),
  };
}

export function call(id: string, name: string, input: unknown) {
  return { id, name, arguments: JSON.stringify(input) };
}
