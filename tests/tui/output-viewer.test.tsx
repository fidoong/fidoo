import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import { AgentController, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { publicEvent as event } from "../helpers/public-event.js";

const artifactId = "a".repeat(64);

describe("Artifact output viewer", () => {
  it("pages large output with Ctrl+O and opens an explicit artifact id", async () => {
    const transport = new OutputTransport();
    const controller = new AgentController(createAgentClient(transport), "/workspace");
    const view = render(
      <TuiApp
        controller={controller}
        options={{ cwd: "/workspace", provider: "fake", model: "fake" }}
        onExit={() => undefined}
      />,
    );
    try {
      view.stdin.write("Output");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Output"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("completed"));
      view.stdin.write("\u000f");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("bash · command-output.txt"));
      expect(view.lastFrame()).toContain("first");
      expect(view.lastFrame()).toContain("second");
      expect(view.lastFrame()).toContain("1-2 / 5");

      view.stdin.write("\u001b[B");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("third"));
      expect(view.lastFrame()).toContain("fourth");
      view.stdin.write("\u001b[B");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("fifth"));
      expect(view.lastFrame()).toContain("end");
      view.stdin.write("\u001b[A");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("third"));
      expect(transport.reads.map((params) => params.offset)).toEqual([0, 2, 4, 2]);

      view.stdin.write("\u001b");
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain("command-output.txt"));
      view.stdin.write(`/artifact ${artifactId}`);
      await vi.waitFor(() => expect(view.lastFrame()).toContain("/artifact"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Artifact aaaaaaaaaaaa"));
      expect(view.lastFrame()).toContain("first");
    } finally {
      view.unmount();
    }
  });
});

class OutputTransport implements AgentTransport {
  readonly reads: Array<{ offset?: number; limit?: number }> = [];

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "run.start") {
      return { runId: "run-1" };
    }
    if (method === "artifact.read") {
      const input = params as { offset?: number; limit?: number };
      this.reads.push(input);
      const offset = input.offset ?? 0;
      const lines = ["first", "second", "third", "fourth", "fifth"];
      const selected = lines.slice(offset, offset + 2);
      return {
        id: artifactId,
        name: "command-output.txt",
        bytes: 100,
        offset,
        limit: 2,
        totalLines: lines.length,
        content: selected.join("\n"),
        ...(offset + selected.length < lines.length
          ? { nextOffset: offset + selected.length }
          : {}),
      };
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(): AsyncIterable<unknown> {
    yield event(1, "run.started", { task: "Output", cwd: "/workspace" });
    yield event(2, "message.user", {
      message: { role: "user", source: "user", content: "Output" },
    });
    yield event(3, "tool.proposed", {
      call: { id: "bash", name: "bash", arguments: '{"command":"pnpm","args":["test"]}' },
    });
    yield event(4, "tool.started", { callId: "bash" });
    yield event(5, "tool.result", {
      result: {
        callId: "bash",
        name: "bash",
        status: "success",
        content: "truncated",
        artifacts: [{ id: artifactId, name: "command-output.txt", bytes: 100 }],
      },
    });
    yield event(6, "message.assistant", { message: { role: "assistant", content: "Done" } });
    yield event(7, "run.completed", { summary: "Done", verification: "not-required" });
  }
}
