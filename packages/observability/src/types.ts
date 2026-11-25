import type { ArtifactReference, PublicRunEvent } from "@fidoo/protocol";

export type RunStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";
export type TraceSpanKind = "run" | "model" | "tool" | "verification";
export type TraceSpanStatus = "running" | "success" | "error" | "rejected" | "incomplete";

export interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  modelCalls: number;
  failedModelCalls: number;
  modelDurationMs: number;
  toolCalls: number;
  failedTools: number;
  approvalWaitMs: number;
  approvals: number;
  compactions: number;
  changedFiles: number;
  verified: boolean;
}

export interface RunListItem {
  runId: string;
  task: string;
  cwd: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  lastSeq: number;
  eventCount: number;
  metrics: RunMetrics;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  kind: TraceSpanKind;
  name: string;
  status: TraceSpanStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  approvalWaitMs?: number;
  callId?: string;
  eventIds: string[];
  detail?: unknown;
}

export interface ObservedMessage {
  eventId: string;
  seq: number;
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  source?: string;
}

export interface TimelineItem {
  id: string;
  eventId: string;
  seq: number;
  timestamp: string;
  type: string;
  label: string;
  detail?: unknown;
}

export interface RunProjection extends RunListItem {
  spans: TraceSpan[];
  messages: ObservedMessage[];
  timeline: TimelineItem[];
  artifacts: ArtifactReference[];
  latestPlan?: unknown;
  finalSummary?: string;
  error?: string;
}

export interface RunEventPage {
  items: PublicRunEvent[];
  afterSeq: number;
  limit: number;
  lastSeq: number;
  hasMore: boolean;
}

export interface RunCollection {
  items: RunListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
