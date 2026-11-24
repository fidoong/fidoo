import { describe, expect, it } from "vitest";
import { appendOnly, buildTimeline } from "../../packages/tui/src/runtime/timeline.js";
import { visibleTail } from "../../packages/tui/src/runtime/viewport.js";

describe("TUI timeline runtime", () => {
  it("keeps append-only history stable when projected entries are reordered", () => {
    const previous = [{ id: "user" }, { id: "answer" }];
    const next = [{ id: "reasoning" }, { id: "answer" }, { id: "user" }, { id: "tools" }];
    expect(appendOnly(previous, next).map((entry) => entry.id)).toEqual([
      "user",
      "answer",
      "reasoning",
      "tools",
    ]);
    expect(appendOnly(previous, previous)).toBe(previous);
  });

  it("keeps reasoning panels out of completed result history", () => {
    const result = buildTimeline({
      messages: [
        { id: "user", seq: 1, role: "user", content: "Task" },
        { id: "answer", seq: 3, role: "assistant", content: "Answer" },
      ],
      streamingText: "",
      tools: [],
    });
    expect(result.entries.map((entry) => entry.kind)).toEqual(["message", "message"]);
  });

  it("bounds an unfinished code block to the visible tail", () => {
    const source = ["```ts", ...Array.from({ length: 30 }, (_, index) => `line ${index}`)].join(
      "\n",
    );
    const visible = visibleTail(source, 8);
    expect(visible).toContain("23 earlier streaming lines");
    expect(visible).toContain("```ts");
    expect(visible).toContain("line 29");
    expect(visible).not.toContain("line 0\n");
  });
});
