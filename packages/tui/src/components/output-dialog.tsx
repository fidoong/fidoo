import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { Spinner } from "./spinner.js";

export function OutputDialog({
  title,
  content,
  offset,
  limit,
  totalLines,
  nextOffset,
  loading,
  error,
}: {
  title: string;
  content: string;
  offset: number;
  limit: number;
  totalLines: number;
  nextOffset?: number | undefined;
  loading: boolean;
  error?: string | undefined;
}) {
  const lines = content ? content.split("\n") : [];
  const occurrences = new Map<string, number>();
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={loading ? theme.accent : theme.border}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>{title}</Text>
        <Text dimColor>
          {totalLines > 0
            ? `${offset + 1}-${Math.min(offset + limit, totalLines)} / ${totalLines}`
            : "empty"}
        </Text>
      </Box>
      {loading ? (
        <Text>
          <Spinner active color={theme.accent} /> <Text dimColor>Loading output…</Text>
        </Text>
      ) : null}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {!loading && !error && lines.length === 0 ? <Text dimColor>No output.</Text> : null}
      {lines.map((line, index) => {
        const occurrence = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, occurrence);
        const lineNumber = offset + index + 1;
        return (
          <Text key={`${line.slice(0, 64)}-${occurrence}`} wrap="wrap">
            <Text dimColor>{String(lineNumber).padStart(5)} │ </Text>
            {line || " "}
          </Text>
        );
      })}
      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>↑/k previous · ↓/j next · Ctrl+O/Esc close</Text>
        <Text dimColor>{nextOffset === undefined ? "end" : "more"}</Text>
      </Box>
    </Box>
  );
}
