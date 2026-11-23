import type { ArtifactReference } from "@fidoo/protocol";

export type TuiPhase =
  | "idle"
  | "starting"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface ViewMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  content: string;
  continuation?: boolean;
}

export interface ViewToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCard extends ViewToolCall {
  seq: number;
  status: "proposed" | "running" | "success" | "error";
  decision: "approved" | "rejected" | undefined;
  summary: string | undefined;
  output: string | undefined;
  artifacts?: ArtifactReference[] | undefined;
}

export interface PendingApproval {
  runId: string;
  call: ViewToolCall;
  risk: "low" | "medium" | "high";
  reason: string;
}

export interface ViewTaskPlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "skipped";
  detail?: string;
  evidence?: string;
}

export interface ViewTaskPlan {
  id: string;
  title: string;
  revision: number;
  steps: ViewTaskPlanStep[];
}

export interface TuiState {
  phase: TuiPhase;
  runId: string | undefined;
  messages: ViewMessage[];
  streamingText: string;
  streamingBlocksStarted: boolean;
  reasoningText: string;
  reasoningActive: boolean;
  reasoningStartedAt: number | undefined;
  reasoningEndedAt: number | undefined;
  tools: ToolCard[];
  taskPlan: ViewTaskPlan | undefined;
  pendingApproval: PendingApproval | undefined;
  changedFiles: string[];
  verificationStatus: "running" | "passed" | "failed" | "not-required" | undefined;
  usage: { inputTokens: number; outputTokens: number };
  lastSeq: number;
  notice: string | undefined;
  error: string | undefined;
}
