import { applyRunEvent, initialTuiState } from "@fidoo/tui";
import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "../../packages/tui/src/store.js";
import { publicEvent as event } from "../helpers/public-event.js";

describe("TUI event projection", () => {
  it("projects streaming messages, tools, diffs and approval without duplicate events", () => {
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "run.started", { task: "Fix", cwd: "/workspace" }));
    state = applyRunEvent(
      state,
      event(2, "message.user", { message: { role: "user", content: "Fix" } }),
    );
    state = applyRunEvent(state, event(2, "message.assistant.delta", { text: "Work" }));
    state = applyRunEvent(state, event(2, "message.assistant.delta", { text: "ing" }));
    state = applyRunEvent(
      state,
      event(3, "message.assistant", { message: { role: "assistant", content: "Working" } }),
    );
    state = applyRunEvent(
      state,
      event(4, "tool.proposed", {
        call: { id: "edit", name: "edit_file", arguments: '{"path":"value.ts"}' },
      }),
    );
    state = applyRunEvent(
      state,
      event(5, "tool.approval_required", {
        callId: "edit",
        risk: "medium",
        reason: "File mutation",
      }),
    );
    expect(state.phase).toBe("awaiting_approval");
    expect(state.pendingApproval?.call.id).toBe("edit");
    state = applyRunEvent(
      state,
      event(6, "tool.decided", { callId: "edit", decision: "approved", reason: "Approved" }),
    );
    state = applyRunEvent(state, event(7, "tool.started", { callId: "edit" }));
    state = applyRunEvent(
      state,
      event(8, "tool.result", {
        result: {
          callId: "edit",
          name: "edit_file",
          status: "success",
          summary: "Edited value.ts",
          content: "--- value.ts\n+++ value.ts\n-old\n+new",
          changedFiles: ["value.ts"],
        },
      }),
    );
    const duplicate = applyRunEvent(state, event(8, "tool.result", { result: { callId: "edit" } }));
    expect(duplicate).toBe(state);
    expect(state.messages.map((message) => message.content)).toEqual(["Fix", "Working"]);
    expect(state.streamingText).toBe("");
    expect(state.tools[0]?.status).toBe("success");
    expect(state.tools[0]?.output).toContain("+new");
    expect(state.changedFiles).toEqual(["value.ts"]);
  });

  it("appends complete streaming blocks without replacing their content", () => {
    const full = "# Title\n\nFirst **paragraph**\n\nTail";
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "message.assistant.delta", { text: full }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe("# Title\n\nFirst **paragraph**\n\n");
    expect(state.streamingText).toBe("Tail");
    state = applyRunEvent(
      state,
      event(2, "message.assistant", {
        message: { role: "assistant", content: full },
      }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ content: "Tail", continuation: true });
    expect(state.messages.map((message) => message.content).join("")).toBe(full);
  });

  it("does not split an unclosed code fence", () => {
    const opening = "```ts\nconst answer = 42;\n\n";
    expect(splitStreamingMarkdown(opening)).toEqual({ complete: "", rest: opening });
    expect(splitStreamingMarkdown(`${opening}\`\`\`\n\nAfter`)).toEqual({
      complete: `${opening}\`\`\`\n\n`,
      rest: "After",
    });
  });

  it("tracks transient reasoning separately and finishes it with the assistant message", () => {
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "message.reasoning.delta", { text: "Inspect " }));
    state = applyRunEvent(state, event(1, "message.reasoning.delta", { text: "first." }));
    expect(state.reasoningText).toBe("Inspect first.");
    expect(state.reasoningActive).toBe(true);
    expect(state.messages).toHaveLength(0);
    state = applyRunEvent(
      state,
      event(2, "message.assistant", { message: { role: "assistant", content: "Answer" } }),
    );
    expect(state.reasoningActive).toBe(false);
    expect(state.reasoningEndedAt).toEqual(expect.any(Number));
    expect(state.messages[0]?.content).toBe("Answer");
  });

  it("bounds retained reasoning to the latest 64K characters", () => {
    const state = applyRunEvent(
      initialTuiState(),
      event(1, "message.reasoning.delta", { text: "x".repeat(64_100) }),
    );
    expect(state.reasoningText).toHaveLength(64_001);
    expect(state.reasoningText.startsWith("…")).toBe(true);
  });

  it("accumulates persistent usage across model requests", () => {
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "model.usage", { inputTokens: 1200, outputTokens: 300 }));
    state = applyRunEvent(state, event(2, "model.usage", { inputTokens: 800, outputTokens: 200 }));
    expect(state.usage).toEqual({ inputTokens: 2000, outputTokens: 500 });
  });

  it("does not duplicate a final markdown summary as a plain-text notice", () => {
    let state = initialTuiState();
    state = applyRunEvent(
      state,
      event(1, "message.assistant", {
        message: { role: "assistant", content: "## Completed\n\n**Verified**" },
      }),
    );
    state = applyRunEvent(
      state,
      event(2, "run.completed", {
        summary: "## Completed\n\n**Verified**",
        verification: "passed",
      }),
    );
    expect(state.notice).toBe("Verification passed");
    expect(state.notice).not.toContain("##");
  });

  it("renders blocked as a terminal state and clears pending approval", () => {
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "run.started", { task: "Deploy", cwd: "/workspace" }));
    state = applyRunEvent(
      state,
      event(2, "tool.proposed", {
        call: { id: "deploy", name: "bash", arguments: '{"command":"deploy"}' },
      }),
    );
    state = applyRunEvent(
      state,
      event(3, "tool.approval_required", {
        callId: "deploy",
        risk: "high",
        reason: "External change",
      }),
    );
    state = applyRunEvent(state, event(4, "run.blocked", { reason: "Credentials required" }));
    expect(state).toMatchObject({
      phase: "blocked",
      error: "Credentials required",
      pendingApproval: undefined,
    });
  });
});
