import { isActivePhase } from "./store.js";
import type { TuiState } from "./types.js";

export interface PlanStep {
  id: "inspect" | "change" | "verify" | "report";
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export function createPlanSteps(state: TuiState): PlanStep[] {
  const active = isActivePhase(state.phase);
  const terminal = ["completed", "failed", "blocked", "cancelled"].includes(state.phase);
  const toolFinished = state.tools.some(
    (tool) => tool.status === "success" || tool.status === "error",
  );
  const hasAssistant = state.messages.some((message) => message.role === "assistant");
  const mutations = state.tools.filter(
    (tool) => tool.name === "edit_file" || tool.name === "write_file",
  );
  const mutationFailed = mutations.some((tool) => tool.status === "error");
  const mutationRunning = mutations.some(
    (tool) => tool.status === "proposed" || tool.status === "running",
  );
  return [
    {
      id: "inspect",
      label: "Inspect",
      status: toolFinished || hasAssistant ? "completed" : active ? "running" : "pending",
    },
    {
      id: "change",
      label: "Change",
      status: mutationFailed
        ? "failed"
        : mutationRunning
          ? "running"
          : mutations.length > 0
            ? "completed"
            : terminal
              ? "skipped"
              : "pending",
    },
    {
      id: "verify",
      label: "Verify",
      status:
        state.verificationStatus === "running"
          ? "running"
          : state.verificationStatus === "passed"
            ? "completed"
            : state.verificationStatus === "failed"
              ? "failed"
              : state.verificationStatus === "not-required" || terminal
                ? "skipped"
                : "pending",
    },
    {
      id: "report",
      label: "Report",
      status: state.phase === "cancelled" ? "skipped" : terminal ? "completed" : "pending",
    },
  ];
}
