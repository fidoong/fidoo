import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ModelEvent, ModelRequest } from "@fidoo/core";
import { DeepSeekModel } from "@fidoo/node-runtime";
import { describe, expect, it } from "vitest";

describe("DeepSeekModel", () => {
  it("preserves reasoning_content across streamed tool-call turns", async () => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requests.length === 1) {
          response.write(sse({ reasoning_content: "Need " }));
          response.write(sse({ reasoning_content: "evidence.", content: "I will read it." }));
          response.write(
            sse(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-read",
                    type: "function",
                    function: { name: "read_file", arguments: '{"path":"math.mjs"}' },
                  },
                ],
              },
              "tool_calls",
            ),
          );
        } else {
          response.write(sse({ reasoning_content: "Verified.", content: "Done" }, "stop"));
          response.write(
            `data: ${JSON.stringify({
              choices: [],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 8,
                prompt_cache_hit_tokens: 80,
                prompt_cache_miss_tokens: 20,
              },
            })}\n\n`,
          );
        }
        response.end("data: [DONE]\n\n");
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const model = new DeepSeekModel({
        apiKey: "test-key",
        baseURL: `http://127.0.0.1:${address.port}`,
      });
      const request: ModelRequest = {
        model: "deepseek-flash",
        systemPrompt: "System rules",
        messages: [{ role: "user", source: "user", content: "Read math.mjs" }],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      };
      const first = await collect(model.stream(request, new AbortController().signal));
      const assistant = first.at(-1);
      if (assistant?.type !== "message.completed") {
        throw new Error("Missing assistant response");
      }
      expect(assistant.message.reasoningContent).toBe("Need evidence.");
      expect(first.filter((event) => event.type === "reasoning.delta")).toEqual([
        { type: "reasoning.delta", text: "Need " },
        { type: "reasoning.delta", text: "evidence." },
      ]);

      const secondRequest: ModelRequest = {
        ...request,
        messages: [
          ...request.messages,
          assistant.message,
          {
            role: "tool",
            toolCallId: "call-read",
            name: "read_file",
            content: "export const answer = 42;",
            isError: false,
          },
        ],
      };
      const second = await collect(model.stream(secondRequest, new AbortController().signal));

      expect(second.filter((event) => event.type === "usage")).toEqual([
        {
          type: "usage",
          inputTokens: 100,
          outputTokens: 8,
          uncachedInputTokens: 20,
          cacheReadTokens: 80,
          cacheWriteTokens: 0,
        },
      ]);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ thinking: { type: "enabled" } });
      expect(requests[0]).not.toHaveProperty("prompt_cache_key");
      expect(requests[1]?.messages).toMatchObject([
        { role: "system" },
        { role: "user" },
        {
          role: "assistant",
          reasoning_content: "Need evidence.",
          tool_calls: [{ id: "call-read" }],
        },
        { role: "tool", tool_call_id: "call-read" },
      ]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function sse(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-deepseek-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-flash",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}
