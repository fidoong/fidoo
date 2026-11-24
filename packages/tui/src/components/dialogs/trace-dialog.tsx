import type { PublicRunEvent } from "@fidoo/protocol";
import { Box, Text } from "ink";
import { theme } from "../../theme/index.js";

export function TraceDialog({ events }: { events: PublicRunEvent[] }) {
  const visible = events.slice(-24);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.muted}
      paddingX={1}
      marginY={1}
    >
      <Text bold color={theme.brand}>
        Event trace · {events.length} event(s)
      </Text>
      {events.length === 0 ? <Text>No events in the current session.</Text> : null}
      {visible.map((event) => (
        <Text key={event.eventId} wrap="wrap">
          {String(event.seq).padStart(3)} {event.type.padEnd(27)} {payload(event)}
        </Text>
      ))}
      <Text dimColor>Latest 24 events · Esc close</Text>
    </Box>
  );
}

function payload(event: PublicRunEvent): string {
  const value = JSON.stringify(event.payload);
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}
