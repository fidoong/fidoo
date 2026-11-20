import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "../theme.js";
import type { TuiState } from "../types.js";
import { Spinner } from "./spinner.js";

export function ReasoningPanel({ state, expanded }: { state: TuiState; expanded: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.reasoningActive) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.reasoningActive]);

  if (!state.reasoningText) {
    return null;
  }
  const endedAt = state.reasoningActive ? now : (state.reasoningEndedAt ?? now);
  const elapsed = Math.max(0, endedAt - (state.reasoningStartedAt ?? endedAt));
  const lines = state.reasoningText.slice(-6000).split("\n").slice(-24);
  const occurrences = new Map<string, number>();
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={state.reasoningActive ? theme.accent : theme.border}
      paddingX={1}
      marginTop={1}
    >
      <Box justifyContent="space-between">
        <Text>
          {state.reasoningActive ? <Spinner active color={theme.accent} /> : <Text>✓</Text>}{" "}
          <Text bold>Reasoning</Text>
          <Text dimColor> · {formatDuration(elapsed)}</Text>
        </Text>
        <Text dimColor>
          {formatCount(state.reasoningText.length)} chars · Ctrl+R{" "}
          {expanded ? "collapse" : "expand"}
        </Text>
      </Box>
      {expanded ? (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((line) => {
            const occurrence = (occurrences.get(line) ?? 0) + 1;
            occurrences.set(line, occurrence);
            return (
              <Text key={`${line.slice(0, 64)}-${occurrence}`} dimColor wrap="wrap">
                {line.length > 300 ? `${line.slice(0, 297)}...` : line || " "}
              </Text>
            );
          })}
          <Text dimColor>Latest {lines.length} lines · transient, not saved to history</Text>
        </Box>
      ) : null}
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
