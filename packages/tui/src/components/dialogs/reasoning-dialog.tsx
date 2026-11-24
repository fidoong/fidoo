import { Box, Text } from "ink";
import type { TuiState } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";
import { ReasoningPanel } from "../conversation/reasoning-panel.js";

export function ReasoningDialog({ state }: { state: TuiState }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold>Reasoning detail</Text>
        <Text dimColor>Ctrl+R / Esc close</Text>
      </Box>
      <ReasoningPanel state={state} expanded />
    </Box>
  );
}
