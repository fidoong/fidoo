import type { RunSummary } from "@fidoo/protocol";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export function SessionsDialog({
  sessions,
  selected,
}: {
  sessions: RunSummary[];
  selected: number;
}) {
  const start = Math.max(0, Math.min(selected - 5, sessions.length - 12));
  const visible = sessions.slice(start, start + 12);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.muted}
      paddingX={1}
      marginY={1}
    >
      <Text bold color={theme.brand}>
        Sessions
      </Text>
      {sessions.length === 0 ? <Text>No saved sessions.</Text> : null}
      {visible.map((session, index) => {
        const position = start + index;
        return (
          <Text key={session.runId} {...(position === selected ? { color: theme.accent } : {})}>
            {position === selected ? "›" : " "} {session.runId.slice(0, 8)}{" "}
            {session.status.padEnd(9)} {short(session.task)}
          </Text>
        );
      })}
      <Text dimColor>↑/↓ navigate · Enter restore · Esc close</Text>
    </Box>
  );
}

function short(value: string): string {
  const line = value.replaceAll("\n", " ");
  return line.length > 64 ? `${line.slice(0, 61)}...` : line;
}
