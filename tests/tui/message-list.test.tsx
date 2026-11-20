import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { MessageList } from "../../packages/tui/src/components/message-list.js";
import type { ToolCard, ViewMessage } from "../../packages/tui/src/types.js";

describe("MessageList", () => {
  it("keeps long history in static output while streaming independently", () => {
    const messages: ViewMessage[] = Array.from({ length: 105 }, (_, index) => ({
      id: `message-${index}`,
      seq: index + 1,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${String(index).padStart(3, "0")}`,
    }));
    const view = render(<MessageList messages={messages} streamingText="streaming" />);
    expect(view.lastFrame()).toContain("message-005");
    expect(view.lastFrame()).toContain("message-104");
    expect(view.lastFrame()).toContain("message-000");
    expect(view.lastFrame()).toContain("streaming");
    view.unmount();
  });

  it("keeps a long tool run from pushing the streaming answer out of view", () => {
    const tools: ToolCard[] = Array.from({ length: 30 }, (_, index) => ({
      id: `verify-${index}`,
      seq: index + 1,
      name: "bash",
      arguments: '{"command":"pnpm","args":["typecheck"]}',
      status: "success",
      decision: "approved",
      summary: "Succeeded",
      output: "typecheck passed",
    }));
    const view = render(
      <MessageList messages={[]} streamingText="Working on the answer" tools={tools.slice(0, 1)} />,
    );
    view.rerender(
      <MessageList messages={[]} streamingText="Working on the answer" tools={tools} />,
    );
    expect(view.lastFrame()).toContain("30 tool calls · bash ×30");
    expect(view.lastFrame()).toContain("Working on the answer");
    expect(view.lastFrame()).not.toContain("bash · pnpm typecheck · success");

    view.rerender(
      <MessageList
        messages={[{ id: "answer", seq: 31, role: "assistant", content: "Final answer" }]}
        streamingText=""
        tools={tools}
      />,
    );
    expect(view.lastFrame()).toContain("30 tool calls · bash ×30");
    expect(view.lastFrame()).toContain("Final answer");
    expect(view.lastFrame()).not.toContain("bash · pnpm typecheck · success");
    view.unmount();
  });

  it("renders continuation blocks as one continuous assistant response", () => {
    const messages: ViewMessage[] = [
      { id: "first", seq: 1, role: "assistant", content: "# Title" },
      {
        id: "continuation",
        seq: 1,
        role: "assistant",
        content: "A paragraph in the same response.",
        continuation: true,
      },
    ];
    const view = render(<MessageList messages={messages} streamingText="" />);
    expect(view.lastFrame()?.match(/ƒ fidoo/g)).toHaveLength(1);
    expect(view.lastFrame()).toContain("A paragraph in the same response.");
    view.unmount();
  });
});
