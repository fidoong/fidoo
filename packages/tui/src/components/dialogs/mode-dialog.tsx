import type { PermissionMode } from "@fidoo/protocol";
import { Box, Text } from "ink";
import { theme } from "../../theme/index.js";

const modes = [
  { id: "manual", label: "Manual", detail: "Approve edits, commands and network actions" },
  { id: "acceptEdits", label: "Accept Edits", detail: "Auto-accept workspace file edits only" },
  { id: "plan", label: "Plan", detail: "Read and plan only, then approve execution" },
  { id: "auto", label: "Auto", detail: "Model-reviewed actions with manual fallback" },
] as const;

export const modeIds = modes.map((mode) => mode.id);

export function ModeDialog({ current, selected }: { current: PermissionMode; selected: number }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      <Text bold>Agent mode</Text>
      <Text dimColor>Enter select · Esc close · Shift+Tab cycle</Text>
      <Box flexDirection="column" marginTop={1}>
        {modes.map((mode, index) => (
          <Text key={mode.id} color={index === selected ? theme.brand : theme.text}>
            {index === selected ? "→ " : "  "}
            {mode.label.padEnd(14)}
            <Text dimColor>{mode.detail}</Text>
            {current === mode.id ? <Text color={theme.success}> · current</Text> : null}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
