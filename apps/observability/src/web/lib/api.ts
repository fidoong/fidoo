import type { RunCollection, RunEventPage, RunProjection, RunStatus } from "@fidoo/observability";

const BASE = "/v1/observability";

export interface RunSummary {
  active: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  failedTools: number;
}

export interface RunsResponse extends RunCollection {
  summary: RunSummary;
}

export interface ArtifactPage {
  id: string;
  name: string;
  bytes: number;
  offset: number;
  limit: number;
  totalLines: number;
  content: string;
  nextOffset?: number;
}

export function getRuns(options: { q?: string; status?: RunStatus; signal?: AbortSignal }) {
  const params = new URLSearchParams({ limit: "100" });
  if (options.q) params.set("q", options.q);
  if (options.status) params.set("status", options.status);
  return request<RunsResponse>(`/runs?${params}`, options.signal);
}

export function getRun(runId: string, signal?: AbortSignal) {
  return request<RunProjection>(`/runs/${runId}`, signal);
}

export function getEvents(runId: string, afterSeq = 0, limit = 200, signal?: AbortSignal) {
  return request<RunEventPage>(`/runs/${runId}/events?afterSeq=${afterSeq}&limit=${limit}`, signal);
}

export function getArtifact(runId: string, artifactId: string, offset = 0, signal?: AbortSignal) {
  return request<ArtifactPage>(
    `/runs/${runId}/artifacts/${artifactId}?offset=${offset}&limit=300`,
    signal,
  );
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, signal ? { signal } : {});
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : undefined;
    throw new Error(typeof message === "string" ? message : `Request failed: ${response.status}`);
  }
  return body as T;
}
