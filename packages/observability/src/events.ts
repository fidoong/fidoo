import type { PublicRunEvent } from "@fidoo/protocol";
import { isTransientRunEvent } from "@fidoo/protocol";
import { redact } from "./redact.js";
import type { RunEventPage } from "./types.js";

export function persistentEvents(events: PublicRunEvent[]): PublicRunEvent[] {
  return events.filter((event) => !isTransientRunEvent(event));
}

export function paginateEvents(events: PublicRunEvent[], afterSeq = 0, limit = 200): RunEventPage {
  const persistent = persistentEvents(events);
  const items = persistent
    .filter((event) => event.seq > afterSeq)
    .slice(0, limit)
    .map((event) => redact(event) as PublicRunEvent);
  const lastSeq = items.at(-1)?.seq ?? afterSeq;
  return {
    items,
    afterSeq,
    limit,
    lastSeq,
    hasMore: persistent.some((event) => event.seq > lastSeq),
  };
}
