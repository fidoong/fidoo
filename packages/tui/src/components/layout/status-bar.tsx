import type { BackgroundTask, PermissionMode } from "@fidoo/protocol";
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
  backgroundTasks = state.backgroundTasks,
}: {
  state: TuiState;
  provider?: string | undefined;
  model?: string | undefined;
  contextLimit?: number;
  backgroundTasks?: BackgroundTask[];
}) {
  const files = state.changedFiles.length;
  const runningTasks = backgroundTasks.filter((task) => task.status === "running").length;
  const runningAgents = state.subagents.filter((agent) => agent.status === "running").length;
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
        <Text color={modeColor(state.permissionMode)}> · {modeLabel(state.permissionMode)}</Text>
        {activity ? <Text color={theme.accent}> · {activity}</Text> : null}
        <Text dimColor>
          {" "}
          · {state.runId ? state.runId.slice(0, 8) : "new"} · {files}{" "}
          {files === 1 ? "file" : "files"}
          {runningAgents > 0
            ? ` · ${runningAgents} ${runningAgents === 1 ? "agent" : "agents"}`
            : ""}
          {runningTasks > 0 ? ` · ${runningTasks} ${runningTasks === 1 ? "task" : "tasks"}` : ""}
          {runningAgents > 0 || runningTasks > 0 ? " · Ctrl+T" : ""}
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

function modeLabel(mode: PermissionMode): string {
  return mode === "acceptEdits" ? "EDIT" : mode.toUpperCase().replace("-", "_");
}

function modeColor(mode: PermissionMode): string {
  if (mode === "plan" || mode === "read-only") return theme.warning;
  if (mode === "auto") return theme.success;
  return theme.brandSecondary;
}

function activityLabel(state: TuiState, now: number): string {
  let label = "";
  if (state.reviewingTool) {
    label = `reviewing · ${state.reviewingTool}`;
  } else if (state.modelActivity.active) {
    const elapsed = Math.max(0, Math.round((now - (state.modelActivity.startedAt ?? now)) / 1000));
    label = `model turn ${state.modelActivity.iteration} · ${elapsed}s`;
  } else if (state.phase === "awaiting_plan") {
    label = "plan approval required";
  } else if (state.phase === "awaiting_approval") {
    label = `approval required${state.pendingApprovals.length > 1 ? ` · ${state.pendingApprovals.length} pending` : ""}`;
  } else if (state.verificationStatus === "running") {
    label = "verifying";
  } else {
    const tool = state.tools.findLast(
      (item) => item.status === "running" || item.status === "proposed",
    );
    if (tool) label = `tool · ${tool.name}`;
  }
  if (state.steeringPending > 0) {
    label += `${label ? " · " : ""}guidance (${state.steeringPending})`;
  }
  return label;
}

function format(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
