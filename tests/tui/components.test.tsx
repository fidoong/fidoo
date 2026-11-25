import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "../../packages/tui/src/components/conversation/tool-call-card.js";
import { ApprovalDialog } from "../../packages/tui/src/components/dialogs/approval-dialog.js";
import { StatusBar } from "../../packages/tui/src/components/layout/status-bar.js";
import { initialTuiState } from "../../packages/tui/src/runtime/store.js";

describe("TUI themed components", () => {
  it("renders a highlighted bash approval", () => {
    const view = render(
      <ApprovalDialog
        approval={{
          runId: "run-1",
          call: {
            id: "verify",
            name: "bash",
            arguments: '{"command":"node","args":["--test","math.test.mjs"]}',
          },
          risk: "medium",
          reason: "Verification command",
        }}
      />,
    );
    expect(view.lastFrame()).toContain("Approval required · bash");
    expect(view.lastFrame()).toContain("node --test math.test.mjs");
    view.unmount();
  });

  it("keeps successful command tools on one line without duplicate output", () => {
    const view = render(
      <ToolCallCard
        tool={{
          id: "verify",
          seq: 1,
          name: "bash",
          arguments: '{"command":"pnpm","args":["test"]}',
          status: "success",
          decision: "approved",
          summary: "Succeeded: pnpm test with a very long duplicated summary",
          output: "full output",
        }}
        expanded={false}
      />,
    );
    expect(view.lastFrame()).toContain("bash · pnpm test · success");
    expect(view.lastFrame()).not.toContain("duplicated summary");
    view.unmount();
  });

  it("keeps provider, model and current context visible in the status area", () => {
    const state = {
      ...initialTuiState(),
      contextTokens: 2500,
    };
    const view = render(
      <StatusBar state={state} provider="kimi-code" model="k3.1-pro" contextLimit={100_000} />,
    );
    expect(view.lastFrame()).toContain("kimi-code");
    expect(view.lastFrame()).toContain("k3.1-pro");
    expect(view.lastFrame()).toContain("ctx 2.5k/100.0k · 3%");
    view.unmount();
  });

  it("shows the active model turn and queued steering instead of a generic spinner", () => {
    const state = {
      ...initialTuiState(),
      phase: "running" as const,
      steeringPending: 1,
      modelActivity: {
        active: true,
        calls: 14,
        durationMs: 0,
        failures: 0,
        iteration: 15,
        startedAt: Date.now() - 5000,
      },
    };
    const view = render(<StatusBar state={state} />);
    expect(view.lastFrame()).toContain("model turn 15");
    expect(view.lastFrame()).toContain("guidance queued (1)");
    view.unmount();
  });

  it("renders compact usage and file metrics", () => {
    const state = {
      ...initialTuiState(),
      usage: {
        inputTokens: 2000,
        outputTokens: 500,
        uncachedInputTokens: 2000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      changedFiles: ["value.ts"],
    };
    const view = render(<StatusBar state={state} />);
    expect(view.lastFrame()).toContain("2.0k in / 500 out");
    expect(view.lastFrame()).toContain("1 file");
    view.unmount();
  });
});
