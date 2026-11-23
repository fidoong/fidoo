import type { RunStatus } from "@fidoo/observability";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { EmptyState, Icon, StatusBadge } from "../../components/ui.js";
import { getRuns, type RunsResponse } from "../../lib/api.js";
import { formatDate, formatDuration, formatTokens } from "../../lib/format.js";

interface Props {
  navigate: (path: string) => void;
}

export function RunsPage({ navigate }: Props) {
  const [data, setData] = useState<RunsResponse>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RunStatus | "">("");
  const searchInput = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await getRuns({
          q: deferredQuery,
          ...(status ? { status } : {}),
          ...(signal ? { signal } : {}),
        });
        setData(result);
        setError(undefined);
      } catch (cause) {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [deferredQuery, status],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  const summary = data?.summary;
  return (
    <div className="page overview-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">AGENT OBSERVABILITY</div>
          <h1>Runs</h1>
          <p>Inspect execution traces, tool activity, and verification evidence.</p>
        </div>
        <div className="live-chip">
          <span className="live-wave" /> Monitoring local store
        </div>
      </header>

      <section className="metric-grid" aria-label="Run metrics">
        <Metric label="Active runs" value={summary?.active} accent />
        <Metric label="Completed" value={summary?.completed} />
        <Metric
          label="Failed / blocked"
          value={summary ? summary.failed + summary.blocked : undefined}
        />
        <Metric label="Tool calls" value={summary?.toolCalls} />
        <Metric
          label="Tokens processed"
          value={summary ? formatTokens(summary.inputTokens + summary.outputTokens) : undefined}
        />
      </section>

      <section className="runs-panel">
        <div className="panel-toolbar">
          <div className="search-field">
            <Icon name="search" />
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, paths, or run IDs"
              aria-label="Search runs"
            />
            <kbd>⌘ K</kbd>
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as RunStatus | "")}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="blocked">Blocked</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="result-count">{data?.total ?? 0} runs</span>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {!data ? (
          <div className="loading-block">Loading local traces…</div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No runs in view"
            detail="Start a Fidoo agent run or adjust the current filters."
          />
        ) : (
          <div className="table-scroll">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Task</th>
                  <th>Duration</th>
                  <th>Tools</th>
                  <th>Tokens</th>
                  <th>Verification</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr
                    key={run.runId}
                    tabIndex={0}
                    onClick={() => navigate(`/runs/${run.runId}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/runs/${run.runId}`);
                      }
                    }}
                  >
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td>
                      <div className="task-cell">
                        <strong>{run.task}</strong>
                        <span>
                          {run.runId.slice(0, 12)} · {run.cwd}
                        </span>
                      </div>
                    </td>
                    <td className="mono">{formatDuration(run.durationMs)}</td>
                    <td className="mono">
                      {run.metrics.toolCalls}
                      <span className={run.metrics.failedTools ? "failed-tools" : "muted"}>
                        {" "}
                        / {run.metrics.failedTools} err
                      </span>
                    </td>
                    <td className="mono">
                      {formatTokens(run.metrics.inputTokens + run.metrics.outputTokens)}
                    </td>
                    <td>
                      {run.metrics.verified ? (
                        <span className="verified">
                          <Icon name="check" /> Passed
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono muted">{formatDate(run.updatedAt)}</td>
                    <td>
                      <Icon name="arrow" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string | undefined;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? "metric-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
      <div className="metric-rule" />
    </div>
  );
}
