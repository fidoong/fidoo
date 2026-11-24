import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import { AgentController, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { publicEvent as event } from "../helpers/public-event.js";

describe("streaming timeline", () => {
  it("keeps previous blocks visible in intermediate and final frames", async () => {
    const transport = new StreamingTransport();
    const controller = new AgentController(createAgentClient(transport), "/workspace");
    const view = render(
      <TuiApp
        controller={controller}
        options={{ cwd: "/workspace", provider: "fake", model: "fake" }}
        onExit={() => undefined}
      />,
    );
    try {
      view.stdin.write("Stream");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Stream"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("First paragraph"));
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Second paragraph"));
      expect(view.lastFrame()).toContain("First paragraph");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("completed"));
      expect(view.lastFrame()?.match(/First paragraph/g)).toHaveLength(1);
      expect(view.lastFrame()?.match(/Second paragraph/g)).toHaveLength(1);
      expect(view.lastFrame()).not.toContain("Reasoning");
      expect(view.lastFrame()).not.toContain("First hidden line");
      expect(view.lastFrame()).not.toContain("Fourth preview line");
      view.stdin.write("\u0012");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("First hidden line"));
      expect(view.lastFrame()).toContain("transient, not saved");
      view.stdin.write("\u0012");
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain("First hidden line"));
    } finally {
      view.unmount();
    }
  });
});

class StreamingTransport implements AgentTransport {
  async call(method: ApiMethod): Promise<unknown> {
    if (method === "run.start") {
      return { runId: "run-1" };
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(): AsyncIterable<unknown> {
    yield event(1, "run.started", { task: "Stream", cwd: "/workspace" });
    yield event(2, "message.user", {
      message: { role: "user", source: "user", content: "Stream" },
    });
    yield event(2, "message.reasoning.delta", {
      text: "First hidden line\nSecond preview line\nThird preview line\nFourth preview line",
    });
    yield event(2, "message.assistant.delta", { text: "First paragraph\n\n" });
    yield event(2, "message.assistant.delta", { text: "Second paragraph\n\n" });
    yield event(2, "message.assistant.delta", { text: "Tail" });
    yield event(3, "message.assistant", {
      message: {
        role: "assistant",
        content: "First paragraph\n\nSecond paragraph\n\nTail",
      },
    });
    yield event(4, "run.completed", { summary: "Done", verification: "not-required" });
  }
}
