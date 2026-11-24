import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import { AgentController, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { publicEvent as event } from "../helpers/public-event.js";

describe("TUI run steering", () => {
  it("accepts guidance while the agent is working", async () => {
    const transport = new SteeringTransport();
    const controller = new AgentController(createAgentClient(transport), "/workspace");
    const view = render(
      <TuiApp
        controller={controller}
        options={{ cwd: "/workspace", provider: "fake", model: "fake" }}
        onExit={() => undefined}
      />,
    );
    try {
      view.stdin.write("Initial task");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Initial task"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Enter steer"));
      view.stdin.write("Keep the API stable");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Keep the API stable"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("completed"));
      expect(transport.steered).toEqual({ runId: "run-1", task: "Keep the API stable" });
      expect(view.lastFrame()).toContain("Keep the API stable");
      expect(view.lastFrame()).toContain("Steered response");
    } finally {
      view.unmount();
    }
  });
});

class SteeringTransport implements AgentTransport {
  steered: unknown;
  private readonly gate = deferred();

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "run.start") {
      return { runId: "run-1" };
    }
    if (method === "run.steer") {
      this.steered = params;
      this.gate.resolve();
      return { ok: true };
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(): AsyncIterable<unknown> {
    yield event(1, "run.started", { task: "Initial task", cwd: "/workspace" });
    yield event(2, "message.user", {
      message: { role: "user", source: "user", content: "Initial task" },
    });
    await this.gate.promise;
    yield event(3, "run.steered", { task: "Keep the API stable" });
    yield event(4, "message.user", {
      message: { role: "user", source: "user", content: "Keep the API stable" },
    });
    yield event(5, "message.assistant", {
      message: { role: "assistant", content: "Steered response" },
    });
    yield event(6, "run.completed", { summary: "Steered response", verification: "not-required" });
  }
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
