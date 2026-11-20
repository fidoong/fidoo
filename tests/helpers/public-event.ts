import type { PublicRunEvent } from "@fidoo/protocol";

export function publicEvent(
  seq: number,
  type: PublicRunEvent["type"],
  payload: Record<string, unknown>,
): PublicRunEvent {
  return {
    protocolVersion: "v1",
    runId: "run-1",
    seq,
    eventId: `event-${seq}-${type}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    payload,
  };
}
