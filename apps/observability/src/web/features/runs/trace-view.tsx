import type { RunProjection, TraceSpan } from "@fidoo/observability";
import { compactJson, formatDuration, formatTime } from "../../lib/format.js";

export function TraceView({
  run,
  selectedSpan,
  onSelect,
}: {
  run: RunProjection;
  selectedSpan: TraceSpan | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="trace-workspace">
      <section className="span-panel">
        <div className="section-heading">
          <span>EXECUTION TRACE</span>
          <span>{run.spans.length - 1} operations</span>
        </div>
        <div className="span-column-labels">
          <span>Operation</span>
          <span>Duration</span>
        </div>
        <div className="span-list">
          {run.spans.map((span) => (
            <button
              type="button"
              key={span.spanId}
              className={`span-row ${selectedSpan?.spanId === span.spanId ? "selected" : ""} ${span.kind === "run" ? "root-span" : ""}`}
              onClick={() => onSelect(span.spanId)}
            >
              <span className={`span-icon span-${span.status}`}>
                {span.kind === "verification" ? "V" : span.kind === "run" ? "ƒ" : "T"}
              </span>
              <span className="span-name">
                <strong>{span.name}</strong>
                <small>
                  {span.kind}
                  {span.callId ? ` · ${span.callId.slice(0, 10)}` : ""}
                </small>
              </span>
              <span className="span-time">
                <strong>{formatDuration(span.durationMs)}</strong>
                <small>{formatTime(span.startedAt)}</small>
              </span>
            </button>
          ))}
        </div>
        {run.latestPlan ? (
          <details className="plan-details">
            <summary>Latest task plan</summary>
            <pre>{compactJson(run.latestPlan)}</pre>
          </details>
        ) : null}
      </section>
      <aside className="detail-inspector">
        <div className="section-heading">
          <span>SPAN DETAIL</span>
          <span>{selectedSpan?.status}</span>
        </div>
        {selectedSpan ? (
          <div className="inspector-content">
            <div className="inspector-title">
              <span className={`span-icon span-${selectedSpan.status}`}>
                {selectedSpan.kind === "run" ? "ƒ" : selectedSpan.kind === "tool" ? "T" : "V"}
              </span>
              <div>
                <h3>{selectedSpan.name}</h3>
                <code>{selectedSpan.spanId}</code>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Started</dt>
                <dd>{formatTime(selectedSpan.startedAt)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(selectedSpan.durationMs)}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{selectedSpan.eventIds.length}</dd>
              </div>
              {selectedSpan.approvalWaitMs !== undefined ? (
                <div>
                  <dt>Approval wait</dt>
                  <dd>{formatDuration(selectedSpan.approvalWaitMs)}</dd>
                </div>
              ) : null}
            </dl>
            <span className="payload-label">REDACTED PAYLOAD</span>
            <pre className="payload-viewer">
              {compactJson(
                selectedSpan.detail ?? {
                  runId: run.runId,
                  status: run.status,
                  changedFiles: run.metrics.changedFiles,
                  compactions: run.metrics.compactions,
                },
              )}
            </pre>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
