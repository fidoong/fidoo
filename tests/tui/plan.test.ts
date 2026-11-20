import { applyRunEvent, createPlanSteps, initialTuiState } from "@fidoo/tui";
import { describe, expect, it } from "vitest";
import { publicEvent as event } from "../helpers/public-event.js";

describe("Run plan projection", () => {
  it("advances only when real tool and verification events arrive", () => {
    let state = initialTuiState();
    state = applyRunEvent(state, event(1, "run.started", { task: "Fix", cwd: "/workspace" }));
    expect(createPlanSteps(state).map((step) => step.status)).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
    ]);

    state = applyRunEvent(
      state,
      event(2, "tool.result", {
        result: { callId: "read", name: "read_file", status: "success", content: "source" },
      }),
    );
    expect(createPlanSteps(state)[0]?.status).toBe("completed");

    state = applyRunEvent(
      state,
      event(3, "tool.proposed", {
        call: { id: "edit", name: "edit_file", arguments: '{"path":"value.ts"}' },
      }),
    );
    expect(createPlanSteps(state)[1]?.status).toBe("running");

    state = applyRunEvent(
      state,
      event(4, "tool.result", {
        result: {
          callId: "edit",
          name: "edit_file",
          status: "success",
          content: "diff",
          changedFiles: ["value.ts"],
        },
      }),
    );
    state = applyRunEvent(
      state,
      event(5, "verification.requested", { attempt: 1, reason: "Verify the edit" }),
    );
    expect(createPlanSteps(state).map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "running",
      "pending",
    ]);

    state = applyRunEvent(
      state,
      event(6, "verification.finished", { success: true, evidence: "exit code 0" }),
    );
    state = applyRunEvent(
      state,
      event(7, "run.completed", { summary: "Fixed", verification: "passed" }),
    );
    expect(createPlanSteps(state).map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("marks unnecessary change and verification steps as skipped", () => {
    let state = initialTuiState();
    state = applyRunEvent(
      state,
      event(1, "message.assistant", { message: { role: "assistant", content: "Answer" } }),
    );
    state = applyRunEvent(
      state,
      event(2, "run.completed", { summary: "Answer", verification: "not-required" }),
    );
    expect(createPlanSteps(state).map((step) => step.status)).toEqual([
      "completed",
      "skipped",
      "skipped",
      "completed",
    ]);
  });
});
