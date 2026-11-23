import type { ModelEvent } from "@fidoo/core";
import { GeminiModel } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("GeminiModel", () => {
  it("normalizes native thought, text, functionCall and usage fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          "data: ",
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { thought: true, text: "Think" },
                    { text: "Hello" },
                    { functionCall: { name: "read_file", args: { path: "a.ts" } } },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
          }),
          "\n\n",
        ].join(""),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const model = new GeminiModel({ apiKey: "test-key" });
    const events: ModelEvent[] = [];
    for await (const event of model.stream(
      {
        model: "gemini-test",
        systemPrompt: "System",
        messages: [{ role: "user", source: "user", content: "Inspect" }],
        tools: [{ name: "read_file", description: "Read", parameters: { type: "object" } }],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    );
    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      message: {
        content: "Hello",
        reasoningContent: "Think",
        toolCalls: [{ name: "read_file", arguments: '{"path":"a.ts"}' }],
      },
    });
    expect(events).toContainEqual({ type: "usage", inputTokens: 20, outputTokens: 8 });
  });
});
