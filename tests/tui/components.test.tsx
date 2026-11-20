import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ApprovalDialog } from "../../packages/tui/src/components/approval-dialog.js";
import { StatusBar } from "../../packages/tui/src/components/status-bar.js";
import { ToolCallCard } from "../../packages/tui/src/components/tool-call-card.js";
import { initialTuiState } from "../../packages/tui/src/store.js";

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

  it("renders compact usage and file metrics", () => {
    const state = {
      ...initialTuiState(),
      usage: { inputTokens: 2000, outputTokens: 500 },
      changedFiles: ["value.ts"],
    };
    const view = render(<StatusBar state={state} />);
    expect(view.lastFrame()).toContain("2.0k in / 500 out");
    expect(view.lastFrame()).toContain("1 file");
    view.unmount();
  });
});
