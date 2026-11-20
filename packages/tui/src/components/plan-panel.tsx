import { Box, Text } from "ink";
import { createPlanSteps, type PlanStep } from "../plan.js";
import { theme } from "../theme.js";
import type { TuiState } from "../types.js";
import { Spinner } from "./spinner.js";

export function PlanPanel({ state }: { state: TuiState }) {
  if (!state.runId) {
    return null;
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
