import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { isActivePhase } from "../../runtime/store.js";
import type { TuiState } from "../../runtime/types.js";
import { statusColor, theme } from "../../theme/index.js";
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
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.modelActivity.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.modelActivity.active]);
  const activity = activityLabel(state, now);
  return (
    <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between">
      <Text>
        <Spinner active={isActivePhase(state.phase)} color={statusColor(state.phase)} />{" "}
        <Text bold>{state.phase}</Text>
        {activity ? <Text color={theme.accent}> · {activity}</Text> : null}
        <Text dimColor>
          {" "}
          · {state.runId ? state.runId.slice(0, 8) : "new session"} · {files}{" "}
          {files === 1 ? "file" : "files"}
        </Text>
      </Text>
      <Box marginLeft={compact ? 0 : 2} marginTop={compact ? 1 : 0}>
        <Text wrap="wrap" dimColor>
          <Text color={theme.brandSecondary}>{provider}</Text> /{" "}
          <Text color={theme.text}>{model}</Text> · ctx {format(state.contextTokens)}/
          {format(contextLimit)} · {contextPercent}% · {format(state.usage.inputTokens)} in /{" "}
          {format(state.usage.outputTokens)} out
        </Text>
      </Box>
    </Box>
  );
}

function activityLabel(state: TuiState, now: number): string {
  let label = "";
  if (state.modelActivity.active) {
    const elapsed = Math.max(0, Math.round((now - (state.modelActivity.startedAt ?? now)) / 1000));
    label = `model turn ${state.modelActivity.iteration} · ${elapsed}s`;
  } else if (state.phase === "awaiting_approval") {
    label = "approval required";
  } else if (state.verificationStatus === "running") {
    label = "verifying";
  } else {
    const tool = state.tools.findLast(
      (item) => item.status === "running" || item.status === "proposed",
    );
    if (tool) label = `tool · ${tool.name}`;
  }
  if (state.steeringPending > 0) {
    label += `${label ? " · " : ""}guidance queued (${state.steeringPending})`;
  }
  return label;
}

function format(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
