import { Box, Text } from "ink";
import type { ViewTaskPlan } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";

const options = [
  { id: "acceptEdits", label: "Approve & Edit" },
  { id: "auto", label: "Approve & Auto" },
  { id: "manual", label: "Approve & Review manually" },
  { id: "revise", label: "Revise plan" },
] as const;

export function PlanApprovalDialog({
  plan,
  selected,
}: {
  plan: ViewTaskPlan | undefined;
  selected: number;
}) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.brand} paddingX={1}>
      <Text bold color={theme.brand}>
        Plan ready{plan ? ` · ${plan.title} · r${plan.revision}` : ""}
      </Text>
      <Text dimColor>Read-only exploration is complete. No execution has been approved yet.</Text>
      <Box flexDirection="column" marginY={1}>
        {plan?.steps.slice(0, 8).map((step) => (
          <Text key={step.id}>
            <Text color={theme.accent}>•</Text> {step.title}
            {step.detail ? <Text dimColor> · {step.detail}</Text> : null}
          </Text>
        ))}
      </Box>
      {options.map((option, index) => (
        <Text key={option.id} color={index === selected ? theme.brand : theme.text}>
          {index === selected ? "→ " : "  "}
          {option.label}
        </Text>
      ))}
      <Text dimColor>↑↓ select · Enter confirm · Esc revise</Text>
    </Box>
  );
}
