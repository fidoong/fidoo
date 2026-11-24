import { Box, Text } from "ink";
import { createPlanSteps, type PlanStep } from "../../runtime/plan.js";
import type { TuiState } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";
import { Spinner } from "../layout/spinner.js";

export function PlanPanel({ state, expanded = false }: { state: TuiState; expanded?: boolean }) {
  if (!state.runId) {
    return null;
  }
  if (!state.taskPlan && ["completed", "failed", "blocked", "cancelled"].includes(state.phase)) {
    return null;
  }
  if (state.taskPlan) {
    if (state.phase !== "running" && state.phase !== "starting" && !expanded) {
      const completed = state.taskPlan.steps.filter((step) => step.status === "completed").length;
      return (
        <Box marginTop={1}>
          <Text dimColor>
            ✓ {state.taskPlan.title} · {completed}/{state.taskPlan.steps.length} steps · /plan
            expand
          </Text>
        </Box>
      );
    }
    const steps = state.taskPlan.steps.map(
      (step): PlanStep => ({
        id: step.id,
        label: step.title,
        status:
          step.status === "in_progress"
            ? "running"
            : step.status === "blocked"
              ? "failed"
              : step.status,
        ...(step.detail ? { detail: step.detail } : {}),
        ...(step.evidence ? { evidence: step.evidence } : {}),
      }),
    );
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold>{state.taskPlan.title}</Text>
          <Text dimColor> · plan r{state.taskPlan.revision}</Text>
        </Text>
        {steps.slice(0, 10).map((step) => {
          const annotation = step.status === "completed" ? step.evidence : step.detail;
          return (
            <Text key={step.id} wrap="wrap">
              <StepIcon step={step} /> <Text color={stepColor(step)}>{step.label}</Text>
              {annotation ? <Text dimColor> · {short(annotation)}</Text> : null}
            </Text>
          );
        })}
        {steps.length > 10 ? <Text dimColor>… {steps.length - 10} more steps</Text> : null}
      </Box>
    );
  }
  const steps = createPlanSteps(state);
  return (
    <Box marginTop={1}>
      <Text wrap="wrap">
        <Text dimColor>Run plan{"  "}</Text>
        {steps.map((step, index) => (
          <Text key={step.id}>
            <StepIcon step={step} /> <Text color={stepColor(step)}>{step.label}</Text>
            {index < steps.length - 1 ? <Text dimColor>{"  ·  "}</Text> : null}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function StepIcon({ step }: { step: PlanStep }) {
  if (step.status === "running") {
    return <Spinner active color={theme.accent} />;
  }
  const icon =
    step.status === "completed"
      ? "✓"
      : step.status === "failed"
        ? "×"
        : step.status === "skipped"
          ? "–"
          : "○";
  return <Text color={stepColor(step)}>{icon}</Text>;
}

function stepColor(step: PlanStep): string {
  if (step.status === "completed") {
    return theme.success;
  }
  if (step.status === "failed") {
    return theme.error;
  }
  if (step.status === "running") {
    return theme.accent;
  }
  return theme.muted;
}

function short(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
