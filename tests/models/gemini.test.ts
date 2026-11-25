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
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 3,
              cachedContentTokenCount: 2,
            },
          }),
          "\n\n",
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
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 8,
              cachedContentTokenCount: 8,
            },
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
        runtimeMessages: [{ role: "user", source: "harness", content: "Dynamic state" }],
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
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as {
      contents: unknown[];
    };
    expect(request.contents).toHaveLength(2);
    expect(events.filter((event) => event.type === "usage")).toEqual([
      {
        type: "usage",
        inputTokens: 20,
        outputTokens: 8,
        uncachedInputTokens: 12,
        cacheReadTokens: 8,
        cacheWriteTokens: 0,
      },
    ]);
  });
});
