import type { RunProjection } from "@fidoo/observability";
import type { PublicRunEvent } from "@fidoo/protocol";
import { isTerminalRunEvent, PUBLIC_RUN_EVENT_TYPES } from "@fidoo/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, StatusBadge } from "../../components/ui.js";
import { getRun } from "../../lib/api.js";
import { formatDuration, formatTime, formatTokens } from "../../lib/format.js";
import { ArtifactsView } from "./artifacts-view.js";
import { EventsView } from "./events-view.js";
import { MessagesView } from "./messages-view.js";
import { TraceView } from "./trace-view.js";

type Tab = "trace" | "messages" | "events" | "artifacts";

export function RunDetailPage({
  runId,
  navigate,
}: {
  runId: string;
  navigate: (path: string) => void;
}) {
  const [run, setRun] = useState<RunProjection>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("trace");
  const [selectedSpanId, setSelectedSpanId] = useState(`${runId}:run`);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSeq = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await getRun(runId, signal);
        lastSeq.current = Math.max(lastSeq.current, result.lastSeq);
        setRun(result);
        setError(undefined);
      } catch (cause) {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [runId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setRun(undefined);
    lastSeq.current = 0;
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (run?.status !== "running") return;
    const stream = new EventSource(
      `/v1/observability/runs/${runId}/stream?afterSeq=${lastSeq.current}`,
    );
    const scheduleRefresh = () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void load();
      }, 200);
    };
    const onEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as PublicRunEvent;
      lastSeq.current = Math.max(lastSeq.current, event.seq);
      scheduleRefresh();
      if (isTerminalRunEvent(event)) {
        stream.close();
        void load();
      }
    };
    for (const type of PUBLIC_RUN_EVENT_TYPES) stream.addEventListener(type, onEvent);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    return () => {
      stream.close();
      setConnected(false);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    };
  }, [load, run?.status, runId]);

  const selectedSpan = run?.spans.find((span) => span.spanId === selectedSpanId) ?? run?.spans[0];
  return (
    <div className="page detail-page">
      <button type="button" className="back-button" onClick={() => navigate("/runs")}>
        <Icon name="arrow" /> All runs
      </button>
      {error ? <div className="error-banner">{error}</div> : null}
      {!run ? (
        <div className="loading-block">Loading execution trace…</div>
      ) : (
        <>
          <header className="run-header">
            <div className="run-heading-row">
              <StatusBadge status={run.status} />
              {run.status === "running" ? (
                <span className={`connection ${connected ? "connected" : ""}`}>
                  {connected ? "Live" : "Reconnecting"}
                </span>
              ) : null}
              <span className="run-id">RUN / {run.runId}</span>
            </div>
            <h1>{run.task}</h1>
            <div className="run-meta">
              <span>{run.cwd}</span>
              <span>Started {formatTime(run.createdAt)}</span>
              <span>{run.eventCount} persistent events</span>
            </div>
          </header>

          <section className="run-stat-strip">
            <RunStat label="Duration" value={formatDuration(run.durationMs)} />
            <RunStat label="Input tokens" value={formatTokens(run.metrics.inputTokens)} />
            <RunStat label="Output tokens" value={formatTokens(run.metrics.outputTokens)} />
            <RunStat label="Tool calls" value={String(run.metrics.toolCalls)} />
            <RunStat label="Approval wait" value={formatDuration(run.metrics.approvalWaitMs)} />
            <RunStat label="Verification" value={run.metrics.verified ? "Passed" : "Not passed"} />
          </section>

          {run.finalSummary ? (
            <div className="summary-banner">
              <Icon name="check" />
              <div>
                <span>FINAL SUMMARY</span>
                {run.finalSummary}
              </div>
            </div>
          ) : null}
          {run.error ? <div className="error-banner">{run.error}</div> : null}

          <div className="detail-tabs" role="tablist" aria-label="Run details">
            <TabButton
              active={tab === "trace"}
              onClick={() => setTab("trace")}
              label="Trace"
              count={run.spans.length}
            />
            <TabButton
              active={tab === "messages"}
              onClick={() => setTab("messages")}
              label="Messages"
              count={run.messages.length}
            />
            <TabButton
              active={tab === "events"}
              onClick={() => setTab("events")}
              label="Raw events"
              count={run.eventCount}
            />
            <TabButton
              active={tab === "artifacts"}
              onClick={() => setTab("artifacts")}
              label="Artifacts"
              count={run.artifacts.length}
            />
          </div>

          {tab === "trace" ? (
            <TraceView run={run} selectedSpan={selectedSpan} onSelect={setSelectedSpanId} />
          ) : null}
          {tab === "messages" ? <MessagesView run={run} /> : null}
          {tab === "events" ? <EventsView run={run} /> : null}
          {tab === "artifacts" ? <ArtifactsView run={run} /> : null}
        </>
      )}
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}
