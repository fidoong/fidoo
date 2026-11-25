import type { Message, RunState } from "@fidoo/core";
import {
  buildModelRequest,
  createEvent,
  emptyRunState,
  reduceEvent,
  ToolRegistry,
  updatePlanTool,
} from "@fidoo/core";
import { describe, expect, it } from "vitest";

describe("ContextBuilder compaction", () => {
  it("keeps the original conversation when it fits", () => {
    const state = conversation([user("Question"), assistant("Answer")]);
    const built = buildModelRequest(state, options(1000));
    expect(built.compaction).toBeUndefined();
    expect(built.request.messages).toHaveLength(2);
    expect(built.request.runtimeMessages).toHaveLength(1);
    expect(built.request.messages).toEqual(state.messages);
  });

  it("bounds long history while preserving the original task and recent messages", () => {
    const messages = Array.from({ length: 16 }, (_, index) =>
      index % 2 === 0
        ? user(`question ${index} ${"x".repeat(300)}`)
        : assistant(`answer ${index} ${"y".repeat(300)}`),
    );
    const state = conversation(messages, "Preserve this original task");
    const built = buildModelRequest(state, options(500));
    expect(built.compaction).toBeDefined();
    expect(built.compaction?.omittedMessages).toBeGreaterThan(0);
    expect(built.compaction?.estimatedAfter).toBeLessThanOrEqual(500);
    expect(built.request.messages[0]?.content).toContain("Preserve this original task");
    expect(built.request.messages.at(-1)).toEqual(messages.at(-1));
  });

  it("retains tool results only with their assistant tool-call message", () => {
    const old = Array.from({ length: 10 }, (_, index) => user(`old ${index} ${"z".repeat(500)}`));
    const toolCall = {
      role: "assistant" as const,
      content: "Calling",
      toolCalls: [{ id: "call-1", name: "read_file", arguments: '{"path":"value.ts"}' }],
    };
    const state = conversation([
      ...old,
      user("Recent question"),
      toolCall,
      {
        role: "tool",
        toolCallId: "call-1",
        name: "read_file",
        content: "file contents",
        isError: false,
      },
      assistant("Latest answer"),
    ]);
    const built = buildModelRequest(state, options(800));
    expect(built.compaction).toBeDefined();
    expect(built.request.messages.some((message) => message.role === "tool")).toBe(true);
    expect(
      built.request.messages.some(
        (message) =>
          message.role === "assistant" && message.toolCalls?.some((call) => call.id === "call-1"),
      ),
    ).toBe(true);
  });

  it("replays a compaction event into the exact retained conversation", () => {
    const state = conversation(
      Array.from({ length: 12 }, (_, index) => user(`message ${index} ${"x".repeat(400)}`)),
    );
    const built = buildModelRequest(state, options(450));
    if (!built.compaction) throw new Error("Expected compaction");
    reduceEvent(
      state,
      createEvent(
        { eventId: "compact-1", runId: state.runId, seq: 1, timestamp: new Date().toISOString() },
        "context.compacted",
        built.compaction,
      ),
    );
    expect(state.messages).toEqual(built.request.messages);
    const rebuilt = buildModelRequest(state, options(450));
    expect(rebuilt.compaction).toBeUndefined();
  });

  it("keeps stable prefixes byte-identical and isolates changing harness state", () => {
    const state = conversation([user("Question"), assistant("Answer")]);
    const requestOptions = { ...options(1000), tools: new ToolRegistry([updatePlanTool]) };
    const first = buildModelRequest(state, requestOptions);
    const second = buildModelRequest(state, requestOptions);
    expect(first.request.tools).toBe(second.request.tools);
    expect(first.request.cache?.staticPrefixHash).toBe(second.request.cache?.staticPrefixHash);
    expect(first.request.cache?.conversationPrefixHash).toBe(
      second.request.cache?.conversationPrefixHash,
    );
    expect(first.request.cache?.key).toBe("workspace-key");

    state.changedFiles.add("value.ts");
    const changed = buildModelRequest(state, requestOptions);
    expect(changed.request.messages).toEqual(first.request.messages);
    expect(changed.request.cache?.conversationPrefixHash).toBe(
      first.request.cache?.conversationPrefixHash,
    );
    expect(changed.request.cache?.requestHash).not.toBe(first.request.cache?.requestHash);
    expect(changed.request.runtimeMessages?.[0]?.content).toContain("value.ts");
    expect(changed.request.runtimeMessages?.[0]?.content).not.toContain("Remaining iterations");
  });

  it("uses the calibrated estimate scale when deciding to compact", () => {
    const state = conversation([user("x".repeat(600))]);
    const built = buildModelRequest(state, { ...options(1500), estimateScale: 10 });
    expect(built.compaction).toBeDefined();
    expect(built.estimatedTokens).toBeLessThanOrEqual(1500);
  });
});

function conversation(messages: Message[], task = "Original task"): RunState {
  const state = emptyRunState("run-context");
  state.task = task;
  state.cwd = "/workspace";
  state.messages = structuredClone(messages);
  return state;
}

function options(maxTokens: number) {
  return {
    model: "test-model",
    systemPrompt: "system",
    tools: new ToolRegistry([]),
    maxTokens,
    cacheKey: "workspace-key",
  };
}

function user(content: string): Message {
  return { role: "user", source: "user", content };
}

function assistant(content: string): Message {
  return { role: "assistant", content };
}
