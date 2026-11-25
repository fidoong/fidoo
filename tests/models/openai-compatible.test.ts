import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AgentError, type ModelEvent } from "@fidoo/core";
import { OpenAICompatibleModel } from "@fidoo/node-runtime";
import { describe, expect, it } from "vitest";

describe("OpenAICompatibleModel", () => {
  it("normalizes streamed text, fragmented tool arguments and usage", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      request.on("data", (chunk) => {
        requestBody += String(chunk);
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(sse({ content: "I will " }));
        response.write(sse({ content: "read it." }));
        response.write(
          sse({
            tool_calls: [
              {
                index: 0,
                id: "call-read",
                type: "function",
                function: { name: "read_file", arguments: '{"path":' },
              },
            ],
          }),
        );
        response.write(
          sse(
            {
              tool_calls: [{ index: 0, function: { arguments: '"math.mjs"}' } }],
            },
            "tool_calls",
          ),
        );
        response.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 1,
            model: "test-model",
            choices: [],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 7,
              total_tokens: 19,
              prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 },
            },
          })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const model = new OpenAICompatibleModel({
        apiKey: "test-key",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        promptCacheKey: true,
      });
      const events: ModelEvent[] = [];
      for await (const event of model.stream(
        {
          model: "test-model",
          systemPrompt: "System rules",
          messages: [{ role: "user", source: "user", content: "Read math.mjs" }],
          runtimeMessages: [{ role: "user", source: "harness", content: "Dynamic state" }],
          cache: {
            key: "workspace-key",
            staticPrefixHash: "static",
            conversationPrefixHash: "conversation",
            requestHash: "request",
          },
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              parameters: { type: "object", properties: { path: { type: "string" } } },
            },
          ],
        },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      expect(events.filter((event) => event.type === "text.delta")).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({
        type: "message.completed",
        message: {
          content: "I will read it.",
          toolCalls: [{ id: "call-read", name: "read_file", arguments: '{"path":"math.mjs"}' }],
        },
      });
      expect(events.filter((event) => event.type === "usage")).toEqual([
        {
          type: "usage",
          inputTokens: 12,
          outputTokens: 7,
          uncachedInputTokens: 5,
          cacheReadTokens: 5,
          cacheWriteTokens: 2,
        },
      ]);
      const request = JSON.parse(requestBody);
      expect(request.messages[0]).toEqual({ role: "system", content: "System rules" });
      expect(request.messages.at(-1)).toEqual({ role: "user", content: "Dynamic state" });
      expect(request.prompt_cache_key).toBe("workspace-key");
      expect(request.tools[0].type).toBe("function");
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("maps tool images to an OpenAI-compatible multimodal user message", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      request.on("data", (chunk) => {
        requestBody += String(chunk);
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`${sse({ content: "ok" })}data: [DONE]\n\n`);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const model = new OpenAICompatibleModel({
        apiKey: "test-key",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        promptCacheKey: true,
      });
      for await (const _event of model.stream(
        {
          model: "vision-model",
          systemPrompt: "System",
          messages: [
            {
              role: "tool",
              toolCallId: "image-call",
              name: "read_image",
              content: "image metadata",
              isError: false,
              images: [
                {
                  artifactId: "a".repeat(64),
                  mimeType: "image/png",
                  name: "pixel.png",
                  bytes: 3,
                  data: "YWJj",
                },
              ],
            },
          ],
          tools: [],
        },
        new AbortController().signal,
      )) {
        void _event;
      }
      const request = JSON.parse(requestBody);
      expect(request.messages[2]).toMatchObject({
        role: "user",
        content: [
          { type: "text" },
          { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
        ],
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("reports timeout, model and a sanitized endpoint", async () => {
    const server = createServer(() => undefined);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const model = new OpenAICompatibleModel({
        apiKey: "test-key",
        baseURL: `http://127.0.0.1:${address.port}/v1?api_key=do-not-leak`,
        timeoutMs: 25,
      });
      const consume = async () => {
        const events: ModelEvent[] = [];
        for await (const event of model.stream(
          {
            model: "slow-model",
            systemPrompt: "System rules",
            messages: [{ role: "user", source: "user", content: "Test" }],
            tools: [],
          },
          new AbortController().signal,
        )) {
          events.push(event);
        }
      };
      const error = await consume().catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(AgentError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("timed out after 25ms");
      expect(message).toContain("slow-model");
      expect(message).toContain(`/v1`);
      expect(message).not.toContain("do-not-leak");
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    }
  });
});

function sse(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}
