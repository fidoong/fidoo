import { Box, Text } from "ink";
import { memo } from "react";
import type { ToolCard } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";
import { Spinner } from "../layout/spinner.js";
import { CodeBlock, CommandHighlight } from "./code.js";

const presentation = {
  proposed: { icon: "·", color: theme.muted, label: "queued" },
  running: { icon: "●", color: theme.warning, label: "running" },
  success: { icon: "✓", color: theme.success, label: "success" },
  error: { icon: "×", color: theme.error, label: "error" },
} as const;

export const ToolCallCard = memo(function ToolCallCard({
  tool,
  expanded,
}: {
  tool: ToolCard;
  expanded: boolean;
}) {
  const diff = tool.name === "edit_file" && tool.output ? tool.output : undefined;
  const status = presentation[tool.status];
  const args = formatArguments(tool.name, tool.arguments);
  const showSummary =
    tool.status === "error" ||
    tool.name === "edit_file" ||
    tool.name === "write_file" ||
    tool.name === "delegate_task" ||
    tool.name === "report_blocked";
  return (
    <Box flexDirection="column" marginBottom={diff || expanded ? 1 : 0}>
      <Text wrap="wrap">
        {tool.status === "running" ? (
          <>
            <Spinner active color={status.color} />{" "}
          </>
        ) : (
          <Text color={status.color}>{status.icon} </Text>
        )}
        <Text bold>{tool.name === "delegate_task" ? "Subagent" : tool.name}</Text>
        <Text dimColor> · </Text>
        {tool.name === "bash" ? <CommandHighlight command={args} /> : <Text dimColor>{args}</Text>}
        <Text dimColor> · </Text>
        <Text color={status.color}>{status.label}</Text>
        {tool.durationMs !== undefined ? (
          <Text dimColor> · {formatDuration(tool.durationMs)}</Text>
        ) : null}
      </Text>
      {tool.decision === "rejected" ? <Text color={theme.error}> rejected</Text> : null}
      {showSummary && tool.summary ? (
        <Text {...(tool.status === "error" ? { color: theme.error } : { dimColor: true })}>
          {"  "}
          {tool.summary}
        </Text>
      ) : null}
      {diff ? <DiffView source={diff} expanded={expanded} /> : null}
      {tool.status === "running" && tool.name === "bash" && tool.output ? (
        <Box marginLeft={2}>
          <CodeBlock code={lastLines(tool.output, 6)} language="text" />
        </Box>
      ) : null}
      {expanded && !diff && tool.output ? (
        <CodeBlock code={limit(tool.output, 200)} language="text" />
      ) : null}
    </Box>
  );
});

export const ToolGroupCard = memo(function ToolGroupCard({ tools }: { tools: ToolCard[] }) {
  const routine = tools.filter(
    (tool) =>
      (tool.status === "success" || tool.status === "error") &&
      tool.name !== "edit_file" &&
      tool.name !== "write_file" &&
      tool.name !== "delegate_task" &&
      tool.name !== "report_blocked",
  );
  const hiddenRoutine = routine.slice(0, -2);
  const visibleRoutine = routine.slice(-2);
  const featured = [...visibleRoutine, ...tools.filter((tool) => !routine.includes(tool))];
  const hasErrors = hiddenRoutine.some((tool) => tool.status === "error");
  return (
    <Box flexDirection="column">
      {hiddenRoutine.length > 0 ? (
        <Text wrap="wrap">
          <Text color={hasErrors ? theme.error : theme.success}>{hasErrors ? "×" : "✓"} </Text>
          <Text bold>
            {hiddenRoutine.length} earlier tool {hiddenRoutine.length === 1 ? "call" : "calls"}
          </Text>
          <Text dimColor> · {formatToolBreakdown(hiddenRoutine)}</Text>
        </Text>
      ) : null}
      {featured.map((tool) => (
        <ToolCallCard key={tool.id} tool={tool} expanded={false} />
      ))}
    </Box>
  );
});

export function formatArguments(name: string, source: string): string {
  try {
    const input = JSON.parse(source) as Record<string, unknown>;
    const value =
      name === "bash"
        ? [input.command, ...(Array.isArray(input.args) ? input.args : [])]
            .filter((part) => part !== undefined)
            .join(" ")
        : name === "delegate_task" && typeof input.task === "string"
          ? input.task
          : typeof input.path === "string"
            ? input.path
            : typeof input.pattern === "string"
              ? String(input.pattern)
              : source;
    return value.length > 100 ? `${value.slice(0, 97)}...` : value;
  } catch {
    return source;
  }
}

function DiffView({ source, expanded }: { source: string; expanded: boolean }) {
  const lines = limit(source, expanded ? 200 : 10).split("\n");
  const occurrences = new Map<string, number>();
  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Text bold>Changes</Text>
      {lines.map((line) => {
        const occurrence = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, occurrence);
        const header = line.startsWith("---") || line.startsWith("+++");
        return (
          <Text
            key={`${line}-${occurrence}`}
            {...(header
              ? { dimColor: true }
              : line.startsWith("+")
                ? { color: theme.success }
                : line.startsWith("-")
                  ? { color: theme.error }
                  : {})}
          >
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function formatToolBreakdown(tools: ToolCard[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count === 1 ? name : `${name} ×${count}`)).join(" · ");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
}

function lastLines(source: string, count: number): string {
  return source
    .split(/\r\n|\r|\n/)
    .slice(-count)
    .join("\n");
}

function limit(source: string, lines: number): string {
  const values = source.split("\n");
  return values.length > lines ? `${values.slice(0, lines).join("\n")}\n…` : source;
}
