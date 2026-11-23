import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import { AgentController, type ThemePreference, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicEvent as event } from "../helpers/public-event.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("TUI keyboard flow", () => {
  it("opens with the monochrome Fidoo welcome", () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame } = renderSession(transport);
    expect(lastFrame()).toContain("ƒ fidoo");
    expect(lastFrame()).toContain("What will you build?");
    expect(lastFrame()).toContain("Start a task");
    expect(lastFrame()).toContain("Workspace");
    expect(lastFrame()).toContain("Ctrl+K command palette");
    expect(lastFrame()).not.toContain("coding-agent");
    expect(lastFrame()).not.toContain("◆ Agent");
  });

  it("submits a task and approves the pending tool with y", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Fix value");
    await vi.waitFor(() => expect(lastFrame()).toContain("Fix value"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Approval required"));
    expect(lastFrame()).toContain("edit_file · value.mjs");
    const frame = lastFrame() ?? "";
    expect(frame.indexOf("ƒ fidoo")).toBeLessThan(frame.indexOf("Keyboard task"));
    stdin.write("\u0012");
    await vi.waitFor(() => expect(lastFrame()).toContain("Hidden setup"));
    stdin.write("\u0012");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("Hidden setup"));
    stdin.write("y");
    await vi.waitFor(() => expect(lastFrame()).toContain("completed"));
    expect(lastFrame()).toContain("Edited value.mjs");
    expect(lastFrame()).toContain("Task fixed");
    expect(lastFrame()).toContain("Verified");
    expect(lastFrame()).not.toContain("## Task fixed");
    expect(lastFrame()).not.toContain("**Verified**");
    expect(transport.approvals).toEqual([
      { runId: "run-1", callId: "edit", decision: "approved", reason: "Approved in TUI" },
    ]);
    stdin.write("\u000f");
    await vi.waitFor(() => expect(lastFrame()).toContain("edit_file output"));
    expect(lastFrame()).toContain("+new");
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("edit_file output"));
  });

  it("cancels the active run with Ctrl+C", async () => {
    const transport = new KeyboardTransport("cancel");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Long task");
    await vi.waitFor(() => expect(lastFrame()).toContain("Long task"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("running"));
    stdin.write("\u0003");
    await vi.waitFor(() => expect(lastFrame()).toContain("cancelled"));
    expect(transport.cancelled).toBe(true);
  });

  it("accepts multiline paste and deletes Unicode without submitting", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("first\r\nsecond 🚀");
    await vi.waitFor(() => expect(lastFrame()).toContain("second 🚀"));
    expect(lastFrame()).toContain("first");
    stdin.write("\u007f");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("🚀"));
    expect(lastFrame()).toContain("second");
    expect(transport.started).toBe(0);
  });

  it("clears a draft with Escape and opens the help panel", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Draft task");
    await vi.waitFor(() => expect(lastFrame()).toContain("Draft task"));
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("Draft task"));
    stdin.write("/help");
    await vi.waitFor(() => expect(lastFrame()).toContain("/help"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Keyboard"));
    expect(lastFrame()).toContain("/resume <run-id>");
    expect(lastFrame()).toContain("Ctrl+O");
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("/resume <run-id>"));
  });

  it("opens the command palette and saves a selected theme", async () => {
    const transport = new KeyboardTransport("approval");
    const saved: ThemePreference[] = [];
    const { lastFrame, stdin } = renderSession(transport, (preference) => {
      saved.push(preference);
    });
    stdin.write("\u000b");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command palette"));
    stdin.write("\u001b[B");
    await vi.waitFor(() => expect(lastFrame()).toContain("› /sessions"));
    stdin.write("\u001b[B");
    await vi.waitFor(() => expect(lastFrame()).toContain("› /trace"));
    stdin.write("\u001b[B");
    await vi.waitFor(() => expect(lastFrame()).toContain("› /theme"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Appearance"));
    stdin.write("\u001b[B");
    await vi.waitFor(() => expect(lastFrame()).toContain("› Graphite"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Theme saved: Graphite"));
    expect(saved).toEqual([{ preset: "graphite" }]);
  });

  it("shows blocked status and the required user action", async () => {
    const transport = new KeyboardTransport("blocked");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Deploy");
    await vi.waitFor(() => expect(lastFrame()).toContain("Deploy"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("blocked"));
    expect(lastFrame()).toContain("Credentials required");
  });
});

function renderSession(
  transport: KeyboardTransport,
  onThemeChange?: (theme: ThemePreference) => void | Promise<void>,
) {
  const controller = new AgentController(createAgentClient(transport), "/workspace");
  const view = render(
    <TuiApp
      controller={controller}
      options={{
        cwd: "/workspace",
        provider: "fake",
        model: "fake-model",
        ...(onThemeChange ? { onThemeChange } : {}),
      }}
      onExit={() => undefined}
    />,
  );
  cleanups.push(() => {
    transport.release();
    view.unmount();
  });
  return { controller, ...view };
}

class KeyboardTransport implements AgentTransport {
  readonly approvals: unknown[] = [];
  started = 0;
  cancelled = false;
  private readonly approvalGate = deferred();
  private readonly cancelGate = deferred();

  constructor(private readonly scenario: "approval" | "cancel" | "blocked") {}

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "run.start") {
      this.started += 1;
      return { runId: "run-1" };
    }
    if (method === "approval.respond") {
      this.approvals.push(params);
      this.approvalGate.resolve();
      return { ok: true };
    }
    if (method === "run.cancel") {
      this.cancelled = true;
      this.cancelGate.resolve();
      return snapshot("cancelled");
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(_method: "run.subscribe", _params: unknown): AsyncIterable<unknown> {
    yield event(1, "run.started", { task: "Keyboard task", cwd: "/workspace" });
    yield event(2, "message.user", {
      message: { role: "user", source: "user", content: "Keyboard task" },
    });
    if (this.scenario === "cancel") {
      await this.cancelGate.promise;
      yield event(3, "run.cancelled", { reason: "Cancelled in TUI" });
      return;
    }
    if (this.scenario === "blocked") {
      yield event(3, "tool.proposed", {
        call: {
          id: "blocked",
          name: "report_blocked",
          arguments: '{"reason":"Credentials required"}',
        },
      });
      yield event(4, "tool.started", { callId: "blocked" });
      yield event(5, "tool.result", {
        result: {
          callId: "blocked",
          name: "report_blocked",
          status: "success",
          content: "Credentials required",
        },
      });
      yield event(6, "run.blocked", { reason: "Credentials required" });
      return;
    }
    yield event(3, "message.assistant.delta", { text: "I will edit the file." });
    yield event(4, "message.assistant", {
      message: { role: "assistant", content: "I will edit the file." },
    });
    yield event(4, "message.reasoning.delta", {
      text: "Hidden setup\nPreview one\nPreview two\nReason before approval.",
    });
    yield event(5, "tool.proposed", {
      call: { id: "edit", name: "edit_file", arguments: '{"path":"value.mjs"}' },
    });
    yield event(6, "tool.approval_required", {
      callId: "edit",
      risk: "medium",
      reason: "File mutation",
    });
    await this.approvalGate.promise;
    yield event(7, "tool.decided", {
      callId: "edit",
      decision: "approved",
      reason: "Approved in TUI",
    });
    yield event(8, "tool.started", { callId: "edit" });
    yield event(9, "tool.result", {
      result: {
        callId: "edit",
        name: "edit_file",
        status: "success",
        summary: "Edited value.mjs",
        content: "--- value.mjs\n+++ value.mjs\n-old\n+new",
        changedFiles: ["value.mjs"],
      },
    });
    yield event(10, "message.assistant", {
      message: { role: "assistant", content: "## Task fixed\n\n**Verified**" },
    });
    yield event(11, "run.completed", {
      summary: "## Task fixed\n\n**Verified**",
      verification: "not-required",
    });
  }

  release(): void {
    this.approvalGate.resolve();
    this.cancelGate.resolve();
  }
}

function snapshot(status: "cancelled") {
  return {
    runId: "run-1",
    task: "Keyboard task",
    cwd: "/workspace",
    status,
    changedFiles: [],
    verified: false,
  };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
