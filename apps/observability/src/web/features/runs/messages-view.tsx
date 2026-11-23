import type { RunProjection } from "@fidoo/observability";
import { EmptyState } from "../../components/ui.js";
import { formatTime } from "../../lib/format.js";

export function MessagesView({ run }: { run: RunProjection }) {
  if (run.messages.length === 0) {
    return (
      <EmptyState
        title="No messages"
        detail="This run has not recorded a user or assistant message."
      />
    );
  }
  return (
    <section className="message-list">
      {run.messages.map((message) => (
        <article key={message.eventId} className={`observed-message message-${message.role}`}>
          <header>
            <span>{message.role === "user" ? "USER" : "ASSISTANT"}</span>
            <time>
              #{message.seq} · {formatTime(message.timestamp)}
            </time>
          </header>
          <pre>{message.content || "No text content"}</pre>
        </article>
      ))}
    </section>
  );
}
