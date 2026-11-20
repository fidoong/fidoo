import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod, PublicRunEvent, RunSummary } from "@fidoo/protocol";
import { AgentController, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicEvent } from "../helpers/public-event.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("TUI session history", () => {
  it("completes and executes slash commands from the Composer", async () => {
    const transport = new HistoryTransport();
    const view = renderHistory(transport);
    view.stdin.write("/se");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Commands"));
    expect(view.lastFrame()).toContain("Browse and restore saved runs");
    view.stdin.write("\t");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("/sessions"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Sessions"));
  });

  it("selects a saved session, restores it and resumes on the next submission", async () => {
    const transport = new HistoryTransport();
    const view = renderHistory(transport);
    await command(view, "/sessions");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Sessions"));
    expect(view.lastFrame()).toContain("Historical task");
    view.stdin.write("\u001b[B");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("› run-two"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Historical answer"));
    expect(view.lastFrame()).toContain("Restored an interrupted run");
    expect(view.lastFrame()).not.toContain("Approval required");

    await command(view, "Continue");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("completed"));
    expect(view.lastFrame()).toContain("Continued");
    expect(transport.resumed).toEqual({ runId: "run-two", task: "Continue" });
  });

  it("restores by run id and opens the canonical event trace", async () => {
    const transport = new HistoryTransport();
    const view = renderHistory(transport);
    await command(view, "/resume run-two");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Historical answer"));
    await command(view, "/trace");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Event trace"));
    expect(view.lastFrame()).toContain("tool.approval_required");
    view.stdin.write("\u001b");
    await vi.waitFor(() => expect(view.lastFrame()).not.toContain("Event trace"));
  });
});

function renderHistory(transport: HistoryTransport) {
  const controller = new AgentController(createAgentClient(transport), "/workspace");
  const view = render(
    <TuiApp
      controller={controller}
      options={{ cwd: "/workspace", provider: "fake", model: "fake-model" }}
      onExit={() => undefined}
    />,
  );
  cleanups.push(() => view.unmount());
  return view;
}

async function command(view: ReturnType<typeof renderHistory>, value: string): Promise<void> {
  view.stdin.write(value);
  await vi.waitFor(() => expect(view.lastFrame()).toContain(value));
  view.stdin.write("\r");
}

class HistoryTransport implements AgentTransport {
  resumed: unknown;
  private readonly events: PublicRunEvent[] = [
    historyEvent(1, "run.started", { task: "Historical task", cwd: "/workspace" }),
    historyEvent(2, "message.user", {
      message: { role: "user", source: "user", content: "Historical question" },
    }),
    historyEvent(3, "message.assistant", {
      message: { role: "assistant", content: "Historical answer" },
    }),
    historyEvent(4, "tool.proposed", {
      call: { id: "old", name: "bash", arguments: '{"command":"old"}' },
    }),
    historyEvent(5, "tool.approval_required", {
      callId: "old",
      risk: "high",
      reason: "Previous process stopped",
    }),
  ];

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "run.list") {
      const sessions: RunSummary[] = [
        summary("run-one", "Other task"),
        summary("run-two", "Historical task"),
      ];
      return sessions;
    }
    if (method === "run.get") {
      return {
        runId: "run-two",
        task: "Historical task",
        cwd: "/workspace",
        status: "running",
        changedFiles: [],
        verified: false,
      };
    }
    if (method === "run.trace") {
      return this.events;
    }
    if (method === "run.resume") {
      this.resumed = params;
      this.events.push(
        historyEvent(6, "run.resumed", { reason: "User continued" }),
        historyEvent(7, "message.user", {
          message: { role: "user", source: "user", content: "Continue" },
        }),
        historyEvent(8, "message.assistant", {
          message: { role: "assistant", content: "Continued" },
        }),
        historyEvent(9, "run.completed", {
          summary: "Continued",
          verification: "not-required",
        }),
      );
      return { ok: true };
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(_method: "run.subscribe", params: unknown): AsyncIterable<unknown> {
    const afterSeq = (params as { afterSeq: number }).afterSeq;
    for (const event of this.events) {
      if (event.seq > afterSeq) {
        yield event;
      }
    }
  }
}

function historyEvent(
  seq: number,
  type: PublicRunEvent["type"],
  payload: Record<string, unknown>,
): PublicRunEvent {
  return { ...publicEvent(seq, type, payload), runId: "run-two" };
}

function summary(runId: string, task: string): RunSummary {
  return {
    runId,
    task,
    cwd: "/workspace",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
