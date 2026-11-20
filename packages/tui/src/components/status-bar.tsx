import { Box, Text } from "ink";
import { isActivePhase } from "../store.js";
import { statusColor, theme } from "../theme.js";
import type { TuiState } from "../types.js";
import { useTerminalColumns } from "./chrome.js";
import { Spinner } from "./spinner.js";

export function StatusBar({ state }: { state: TuiState }) {
  const files = state.changedFiles.length;
  const compact = useTerminalColumns() < 72;
  return (
    <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between" marginTop={1}>
      <Text>
        <Spinner active={isActivePhase(state.phase)} color={statusColor(state.phase)} />{" "}
        <Text bold>{state.phase}</Text>
        <Text dimColor>
          {" "}
          · {state.runId ? state.runId.slice(0, 8) : "new session"} · {files}{" "}
          {files === 1 ? "file" : "files"}
        </Text>
      </Text>
      <Text dimColor>
        {format(state.usage.inputTokens)} in / {format(state.usage.outputTokens)} out · Ctrl+O ·{" "}
        <Text color={theme.muted}>/help</Text>
      </Text>
    </Box>
  );
}

function format(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
