import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { TuiState } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";
import { Spinner } from "../layout/spinner.js";

export function ReasoningPanel({ state, expanded }: { state: TuiState; expanded: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.reasoningActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.reasoningActive]);

  if (!state.reasoningText) return null;
  const endedAt = state.reasoningActive ? now : (state.reasoningEndedAt ?? now);
  const elapsed = Math.max(0, endedAt - (state.reasoningStartedAt ?? endedAt));
  const lines = state.reasoningText.slice(-6000).split("\n").slice(-24);
  const previewLines = state.reasoningText
    .split("\n")
    .filter((line) => line.trim())
    .slice(-3);
  const visibleLines = expanded ? lines : previewLines;
  const occurrences = new Map<string, number>();
  return (
    <Box flexDirection="column" marginY={1}>
      <Text wrap="wrap">
        <Text color={theme.border}>╭─ </Text>
        {state.reasoningActive ? (
          <Spinner active color={theme.accent} />
        ) : (
          <Text color={theme.success}>✓</Text>
        )}{" "}
        <Text bold>Reasoning</Text>
        <Text dimColor>
          {" "}
          · {formatDuration(elapsed)} · {formatCount(state.reasoningText.length)} chars
        </Text>
      </Text>
      {visibleLines.map((line) => {
        const occurrence = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, occurrence);
        const limit = expanded ? 300 : 160;
        return (
          <Text key={`${line.slice(0, 64)}-${occurrence}`} wrap="wrap">
            <Text color={theme.border}>│ </Text>
            <Text dimColor>
              {line.length > limit ? `${line.slice(0, limit - 3)}...` : line || " "}
            </Text>
          </Text>
        );
      })}
      <Text>
        <Text color={theme.border}>╰─ </Text>
        <Text dimColor>
          {expanded ? `Latest ${lines.length} lines` : "Ctrl+R expand"} · transient, not saved
        </Text>
      </Text>
    </Box>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
