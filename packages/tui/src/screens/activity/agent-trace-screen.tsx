import type { PublicRunEvent } from "@fidoo/protocol";
import { Box, Text } from "ink";
import type { SubagentCard } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";

export function AgentTraceScreen({
  agent,
  events,
  loading,
  error,
}: {
  agent: SubagentCard;
  events: PublicRunEvent[];
  loading: boolean;
  error?: string | undefined;
}) {
  const visible = events.slice(-16);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      <Text bold color={theme.brand}>
        Subagent · {agent.runId.slice(0, 8)}
      </Text>
      <Text dimColor>
        {agent.status} · read-only · {events.length} events
      </Text>
      <Text wrap="wrap">{agent.task}</Text>
      <Box flexDirection="column" marginY={1}>
        {loading ? <Text dimColor>Loading child run…</Text> : null}
        {error ? <Text color={theme.error}>{error}</Text> : null}
        {!loading && visible.length === 0 ? <Text dimColor>No events.</Text> : null}
        {visible.map((event) => (
          <Text key={event.eventId} wrap="truncate-end">
            <Text dimColor>{String(event.seq).padStart(3)} </Text>
            <Text color={event.type.startsWith("run.") ? theme.accent : theme.text}>
              {event.type}
            </Text>
            <Text dimColor> {payload(event)}</Text>
          </Text>
        ))}
      </Box>
      {agent.summary ? <Text wrap="wrap">{agent.summary}</Text> : null}
      <Text dimColor>↑↓ scroll in Trace · r refresh · Esc back</Text>
    </Box>
  );
}

function payload(event: PublicRunEvent): string {
  if (event.type === "message.assistant" || event.type === "message.user") {
    const message = event.payload.message as { content?: unknown } | undefined;
    return String(message?.content ?? "")
      .replaceAll("\n", " ")
      .slice(0, 100);
  }
  if (event.type === "tool.proposed") {
    const call = event.payload.call as { name?: unknown } | undefined;
    return String(call?.name ?? "");
  }
  if (event.type === "tool.result") {
    const result = event.payload.result as { summary?: unknown; content?: unknown } | undefined;
    return String(result?.summary ?? result?.content ?? "")
      .replaceAll("\n", " ")
      .slice(0, 100);
  }
  return "";
}
