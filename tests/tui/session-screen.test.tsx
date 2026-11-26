import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import { AgentController, type ThemePreference, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commandDefinitions,
  paletteDefinitions,
} from "../../packages/tui/src/commands/definitions.js";
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
    const lines = (lastFrame() ?? "").split("\n");
    expect(lines.find((line) => line.includes("ƒ fidoo"))).toMatch(/^ƒ fidoo/);
    expect(lines.find((line) => line.includes("What will you build?"))).toMatch(
      /^ {2}What will you build\?/,
    );
    expect(lines.find((line) => line.includes("idle"))).toMatch(/^\S/);
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
    stdin.write("/status");
    await vi.waitFor(() => expect(lastFrame()).toContain("/status"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Run status"));
    expect(lastFrame()).toContain("fake / fake-model");
    expect(lastFrame()).toContain("completed");
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("Read-only status"));
    expect(transport.approvals).toEqual([
      { runId: "run-1", callId: "edit", decision: "approved", reason: "Approved in TUI" },
    ]);
    stdin.write("\u000f");
    await vi.waitFor(() => expect(lastFrame()).toContain("edit_file output"));
    expect(lastFrame()).toContain("+new");
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).not.toContain("edit_file output"));
  });

  it("shows every concurrent approval in order before completing the run", async () => {
    const transport = new KeyboardTransport("concurrent");
    const { controller, lastFrame, stdin } = renderSession(transport);
    stdin.write("Fetch both");
    await vi.waitFor(() => expect(lastFrame()).toContain("Fetch both"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Approval required"));
    expect(lastFrame()).toContain("1/2");
    expect(lastFrame()).toContain("https://a.example");
    stdin.write("y");
    await vi.waitFor(() => expect(transport.approvals).toHaveLength(1));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().pendingApprovals[0]?.call.id).toBe("call-b"),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("https://b.example"));
    expect(lastFrame()).toContain("Approval required");
    stdin.write("y");
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("completed"));
    expect(transport.approvals.map((approval) => (approval as { callId: string }).callId)).toEqual([
      "call-a",
      "call-b",
    ]);
    expect(controller.getSnapshot().pendingApprovals).toEqual([]);
  });

  it("cycles behavior mode with Shift+Tab before starting a run", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("\u001b[Z");
    await vi.waitFor(() => expect(lastFrame()).toContain("EDIT"));
    stdin.write("Fix value");
    await vi.waitFor(() => expect(lastFrame()).toContain("Fix value"));
    stdin.write("\r");
    await vi.waitFor(() => expect(transport.started).toBe(1));
    expect(transport.startParams[0]).toMatchObject({ mode: "acceptEdits" });
  });

  it("approves a read-only plan into Accept Edits mode", async () => {
    const transport = new KeyboardTransport("plan");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Plan a fix");
    await vi.waitFor(() => expect(lastFrame()).toContain("Plan a fix"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Plan ready"));
    expect(lastFrame()).toContain("Approve & Edit");
    stdin.write("\r");
    await vi.waitFor(() => expect(transport.planResponses).toHaveLength(1));
    expect(transport.planResponses[0]).toMatchObject({
      decision: "approved",
      mode: "acceptEdits",
    });
    await vi.waitFor(() => expect(lastFrame()).toContain("completed"));
  });

  it("navigates background tasks and opens live output", async () => {
    const transport = new KeyboardTransport("approval");
    transport.backgroundTasks = [
      {
        taskId: "task-1",
        runId: "run-1",
        command: "pnpm",
        args: ["dev"],
        cwd: "/workspace",
        pid: 1234,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("/tasks");
    await vi.waitFor(() => expect(lastFrame()).toContain("/tasks"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("Activity"));
    await vi.waitFor(() => expect(lastFrame()).toContain("pnpm dev"));
    expect(lastFrame()).toContain("Processes (1)");
    stdin.write("\u001b[C");
    await vi.waitFor(() => expect(lastFrame()).toContain("› Agents"));
    stdin.write("\u001b[D");
    await vi.waitFor(() => expect(lastFrame()).toContain("› Processes"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("server ready"));
    expect(lastFrame()).toContain("listening on 3000");
    expect(lastFrame()).toContain("following");
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).toContain("Processes (1)"));
    stdin.write("s");
    await vi.waitFor(() => expect(lastFrame()).toContain("Stop background process?"));
    expect(lastFrame()).toContain("Keep running");
    stdin.write("\u001b[C");
    await vi.waitFor(() => expect(lastFrame()).toContain("› Stop process"));
    stdin.write("\r");
    await vi.waitFor(() => expect(transport.stoppedTasks).toHaveLength(1));
    expect(transport.stoppedTasks[0]).toMatchObject({
      taskId: "task-1",
      runId: "run-1",
      confirmed: true,
    });
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

  it("shows every command in slash completion instead of truncating the list", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame()).toContain(`${commandDefinitions.length} commands`));
    expect(lastFrame()).toContain("/status");
    expect(lastFrame()).toContain("/plan");
    expect(lastFrame()).toContain("/output");
    expect(lastFrame()).toContain("/cancel");
    expect(lastFrame()).toContain("/resume <run-id>");
    expect(lastFrame()).toContain("/artifact <id>");
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

  it("preserves a composer draft and supports left and right cursor movement", async () => {
    const transport = new KeyboardTransport("approval");
    const { lastFrame, stdin } = renderSession(transport);
    stdin.write("Draft");
    await vi.waitFor(() => expect(lastFrame()).toContain("Draft"));
    stdin.write("\u001b[D");
    stdin.write("X");
    await vi.waitFor(() => expect(lastFrame()).toContain("DrafX▌t"));
    stdin.write("\u000b");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command palette"));
    stdin.write("\u001b");
    await vi.waitFor(() => expect(lastFrame()).toContain("DrafX▌t"));
    expect(transport.started).toBe(0);
  });

  it("opens the command palette and saves a selected theme", async () => {
    const transport = new KeyboardTransport("approval");
    const saved: ThemePreference[] = [];
    const { lastFrame, stdin } = renderSession(transport, (preference) => {
      saved.push(preference);
    });
    stdin.write("\u000b");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command palette"));
    const traceIndex = paletteDefinitions.findIndex((item) => item.name === "/trace");
    const themeIndex = paletteDefinitions.findIndex((item) => item.name === "/theme");
    for (let index = 1; index <= traceIndex; index += 1) {
      stdin.write("\u001b[B");
      const name = paletteDefinitions[index]?.name ?? "";
      await vi.waitFor(() => expect(lastFrame()).toContain(`› ${name}`));
    }
    for (let index = traceIndex + 1; index <= themeIndex; index += 1) {
      stdin.write("\u001b[B");
      const name = paletteDefinitions[index]?.name ?? "";
      await vi.waitFor(() => expect(lastFrame()).toContain(`› ${name}`));
    }
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
  readonly startParams: Record<string, unknown>[] = [];
  readonly planResponses: Record<string, unknown>[] = [];
  readonly stoppedTasks: unknown[] = [];
  backgroundTasks: Array<Record<string, unknown>> = [];
  started = 0;
  cancelled = false;
  private readonly approvalGate = deferred();
  private readonly concurrentApprovalGates = [deferred(), deferred()] as const;
  private readonly cancelGate = deferred();
  private readonly planGate = deferred();

  constructor(
    private readonly scenario: "approval" | "cancel" | "blocked" | "plan" | "concurrent",
  ) {}

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "run.start") {
      this.started += 1;
      this.startParams.push(params as Record<string, unknown>);
      return { runId: "run-1" };
    }
    if (method === "plan.respond") {
      this.planResponses.push(params as Record<string, unknown>);
      this.planGate.resolve();
      return { ok: true };
    }
    if (method === "mode.set") {
      return { mode: (params as { mode: string }).mode };
    }
    if (method === "approval.respond") {
      this.approvals.push(params);
      this.approvalGate.resolve();
      this.concurrentApprovalGates[this.approvals.length - 1]?.resolve();
      return { ok: true };
    }
    if (method === "run.cancel") {
      this.cancelled = true;
      this.cancelGate.resolve();
      return snapshot("cancelled");
    }
    if (method === "task.list") {
      const runId = (params as { runId?: string }).runId;
      return runId
        ? this.backgroundTasks.filter((task) => task.runId === runId)
        : this.backgroundTasks;
    }
    if (method === "task.output") {
      const input = params as { taskId: string; offset?: number; limit?: number };
      return {
        taskId: input.taskId,
        offset: input.offset ?? 0,
        limit: input.limit ?? 200,
        totalLines: 2,
        content: "server ready\nlistening on 3000",
        nextOffset: undefined,
      };
    }
    if (method === "task.stop") {
      this.stoppedTasks.push(params);
      const input = params as { taskId: string };
      const task = this.backgroundTasks.find((item) => item.taskId === input.taskId);
      if (task) task.status = "stopped";
      return task;
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  async *subscribe(
    method: "run.subscribe" | "task.subscribe",
    _params: unknown,
  ): AsyncIterable<unknown> {
    if (method === "task.subscribe") return;
    yield event(1, "run.started", {
      task: "Keyboard task",
      cwd: "/workspace",
      permissionMode: this.scenario === "plan" ? "plan" : "manual",
    });
    yield event(2, "message.user", {
      message: { role: "user", source: "user", content: "Keyboard task" },
    });
    if (this.scenario === "concurrent") {
      yield event(3, "tool.proposed", {
        call: { id: "call-a", name: "web_fetch", arguments: '{"url":"https://a.example"}' },
      });
      yield event(4, "tool.proposed", {
        call: { id: "call-b", name: "web_fetch", arguments: '{"url":"https://b.example"}' },
      });
      yield event(5, "tool.approval_required", {
        callId: "call-a",
        risk: "medium",
        reason: "Review A",
      });
      yield event(6, "tool.approval_required", {
        callId: "call-b",
        risk: "medium",
        reason: "Review B",
      });
      await this.concurrentApprovalGates[0].promise;
      const first = (this.approvals[0] as { callId: string }).callId;
      yield event(7, "tool.decided", {
        callId: first,
        decision: "approved",
        reason: "Approved in TUI",
      });
      yield event(8, "tool.started", { callId: first });
      yield event(9, "tool.result", {
        result: {
          callId: first,
          name: "web_fetch",
          status: "success",
          content: "First complete",
        },
      });
      await this.concurrentApprovalGates[1].promise;
      const second = (this.approvals[1] as { callId: string }).callId;
      yield event(10, "tool.decided", {
        callId: second,
        decision: "approved",
        reason: "Approved in TUI",
      });
      yield event(11, "tool.started", { callId: second });
      yield event(12, "tool.result", {
        result: {
          callId: second,
          name: "web_fetch",
          status: "success",
          content: "Second complete",
        },
      });
      yield event(13, "message.assistant", {
        message: { role: "assistant", content: "Both approved" },
      });
      yield event(14, "run.completed", {
        summary: "Both approved",
        verification: "not-required",
      });
      return;
    }
    if (this.scenario === "cancel") {
      await this.cancelGate.promise;
      yield event(3, "run.cancelled", { reason: "Cancelled in TUI" });
      return;
    }
    if (this.scenario === "plan") {
      yield event(3, "plan.updated", {
        plan: {
          id: "plan-1",
          title: "Fix value",
          revision: 1,
          steps: [{ id: "edit", title: "Edit value.mjs", status: "pending" }],
        },
      });
      yield event(4, "plan.awaiting_approval", { planId: "plan-1", requestedMode: "manual" });
      await this.planGate.promise;
      yield event(5, "plan.approved", { planId: "plan-1", mode: "acceptEdits" });
      yield event(6, "mode.changed", { mode: "acceptEdits", reason: "Plan approved" });
      yield event(7, "run.resumed", { reason: "Plan approved" });
      yield event(8, "message.assistant", {
        message: { role: "assistant", content: "Plan approved and completed" },
      });
      yield event(9, "run.completed", {
        summary: "Plan approved and completed",
        verification: "not-required",
      });
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
    for (const gate of this.concurrentApprovalGates) gate.resolve();
    this.cancelGate.resolve();
    this.planGate.resolve();
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
