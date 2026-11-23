import { Box, Text } from "ink";
import { isActivePhase } from "../store.js";
import { statusColor, theme } from "../theme.js";
import type { TuiState } from "../types.js";
import { useTerminalColumns } from "./chrome.js";
import { Spinner } from "./spinner.js";

export function StatusBar({
  state,
  provider = "agent",
  model = "not configured",
  contextLimit = 100_000,
}: {
  state: TuiState;
  provider?: string | undefined;
  model?: string | undefined;
  contextLimit?: number;
}) {
  const files = state.changedFiles.length;
  const compact = useTerminalColumns() < 72;
  const contextPercent = Math.round((state.contextTokens / contextLimit) * 100);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between">
        <Text>
          <Spinner active={isActivePhase(state.phase)} color={statusColor(state.phase)} />{" "}
          <Text bold>{state.phase}</Text>
          <Text dimColor>
            {" "}
            · {state.runId ? state.runId.slice(0, 8) : "new session"} · {files}{" "}
            {files === 1 ? "file" : "files"}
          </Text>
        </Text>
        <Text wrap="wrap">
          <Text color={theme.brandSecondary}>{provider}</Text>
          <Text dimColor> / </Text>
          <Text color={theme.text}>{model}</Text>
        </Text>
      </Box>
      <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between">
        <Text dimColor>
          context {format(state.contextTokens)} / {format(contextLimit)} · {contextPercent}%
        </Text>
        <Text dimColor>
          {format(state.usage.inputTokens)} in / {format(state.usage.outputTokens)} out · Ctrl+O ·{" "}
          <Text color={theme.muted}>/help</Text>
        </Text>
      </Box>
    </Box>
  );
}

function format(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
