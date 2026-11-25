import type { ModelEvent } from "@fidoo/core";
import { AnthropicModel } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("AnthropicModel", () => {
  it("normalizes native text, thinking, tool calls and usage from SSE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse());
    vi.stubGlobal("fetch", fetchMock);
    const model = new AnthropicModel({ apiKey: "test-key" });
    const events = await collect(model);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as {
      messages: { content: string | { cache_control?: unknown }[] }[];
      system: { cache_control?: unknown }[];
      tools: unknown[];
    };
    expect(request.system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(request.messages[0]?.content[0]).toMatchObject({
      text: "Inspect",
      cache_control: { type: "ephemeral" },
    });
    expect(request.messages[1]).toEqual({ role: "user", content: "Dynamic state" });
    expect(request.tools[0]).toMatchObject({ name: "read_file", input_schema: { type: "object" } });
    expect(events.filter((event) => event.type === "text.delta")).toEqual([
      { type: "text.delta", text: "Hello" },
    ]);
    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      message: {
        content: "Hello",
        reasoningContent: "Plan",
        toolCalls: [{ id: "call-1", name: "read_file", arguments: '{"path":"a.ts"}' }],
      },
    });
    expect(events.filter((event) => event.type === "usage")).toEqual([
      {
        type: "usage",
        inputTokens: 12,
        outputTokens: 5,
        uncachedInputTokens: 2,
        cacheReadTokens: 7,
        cacheWriteTokens: 3,
      },
    ]);
  });
});

async function collect(model: AnthropicModel): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of model.stream(
    {
      model: "claude-test",
      systemPrompt: "System",
      messages: [{ role: "user", source: "user", content: "Inspect" }],
      runtimeMessages: [{ role: "user", source: "harness", content: "Dynamic state" }],
      cache: {
        staticPrefixHash: "static",
        conversationPrefixHash: "conversation",
        requestHash: "request",
      },
      tools: [{ name: "read_file", description: "Read", parameters: { type: "object" } }],
    },
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
}

function sseResponse(): Response {
  const frames = [
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 3,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "call-1", name: "read_file", input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' },
    },
    { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Plan" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Hello" } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
  ];
  const body = frames
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
