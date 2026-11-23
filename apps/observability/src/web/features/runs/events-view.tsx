import type { RunProjection } from "@fidoo/observability";
import type { PublicRunEvent } from "@fidoo/protocol";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../components/ui.js";
import { getEvents } from "../../lib/api.js";
import { formatTime } from "../../lib/format.js";

export function EventsView({ run }: { run: RunProjection }) {
  const [events, setEvents] = useState<PublicRunEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PublicRunEvent>();
  const load = useCallback(
    async (afterSeq: number) => {
      setLoading(true);
      const page = await getEvents(run.runId, afterSeq);
      setEvents((current) => (afterSeq === 0 ? page.items : [...current, ...page.items]));
      setHasMore(page.hasMore);
      setLoading(false);
    },
    [run.runId],
  );
  useEffect(() => {
    setEvents([]);
    setSelected(undefined);
    void load(0);
  }, [load]);
  return (
    <div className="events-workspace">
      <section className="events-panel">
        <div className="section-heading">
          <span>PERSISTENT EVENTS</span>
          <span>Redacted</span>
        </div>
        {events.map((event) => (
          <button
            type="button"
            key={event.eventId}
            className={`event-row ${selected?.eventId === event.eventId ? "selected" : ""}`}
            onClick={() => setSelected(event)}
          >
            <span className="event-seq">#{event.seq}</span>
            <strong>{event.type}</strong>
            <time className="event-time">{formatTime(event.timestamp)}</time>
          </button>
        ))}
        {hasMore ? (
          <button
            type="button"
            className="load-more"
            disabled={loading}
            onClick={() => void load(events.at(-1)?.seq ?? 0)}
          >
            {loading ? "Loading…" : "Load next 200 events"}
          </button>
        ) : null}
        {!loading && events.length === 0 ? (
          <EmptyState title="No events" detail="No persistent events are available." />
        ) : null}
      </section>
      <aside className="detail-inspector">
        <div className="section-heading">
          <span>EVENT JSON</span>
          <span>{selected ? `#${selected.seq}` : ""}</span>
        </div>
        <pre className="payload-viewer event-json">
          {selected
            ? JSON.stringify(selected, null, 2)
            : "Select an event to inspect its redacted payload."}
        </pre>
      </aside>
    </div>
  );
}
