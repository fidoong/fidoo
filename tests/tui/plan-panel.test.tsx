import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { PlanPanel } from "../../packages/tui/src/components/plan-panel.js";
import { initialTuiState } from "../../packages/tui/src/store.js";

describe("Task plan panel", () => {
  it("renders the durable agent plan and evidence instead of the derived fallback", () => {
    const state = {
      ...initialTuiState(),
      runId: "run-plan",
      taskPlan: {
        id: "plan-1",
        title: "Repair the billing flow",
        revision: 3,
        steps: [
          {
            id: "inspect",
            title: "Trace the failing payment path",
            status: "completed" as const,
            evidence: "Found the incorrect currency conversion",
          },
          {
            id: "change",
            title: "Update conversion and regression tests",
            status: "in_progress" as const,
            detail: "Keeping the public API unchanged",
          },
          { id: "verify", title: "Run billing tests", status: "pending" as const },
        ],
      },
    };
    const view = render(<PlanPanel state={state} />);
    expect(view.lastFrame()).toContain("Repair the billing flow · plan r3");
    expect(view.lastFrame()).toContain("Found the incorrect currency conversion");
    expect(view.lastFrame()).toContain("Keeping the public API unchanged");
    expect(view.lastFrame()).toContain("Run billing tests");
    expect(view.lastFrame()).not.toContain("Run plan");
    view.unmount();
  });
});
