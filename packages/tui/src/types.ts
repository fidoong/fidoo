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
}

export interface PendingApproval {
  runId: string;
  call: ViewToolCall;
  risk: "low" | "medium" | "high";
  reason: string;
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
  pendingApproval: PendingApproval | undefined;
  changedFiles: string[];
  verificationStatus: "running" | "passed" | "failed" | "not-required" | undefined;
  usage: { inputTokens: number; outputTokens: number };
  lastSeq: number;
  notice: string | undefined;
  error: string | undefined;
}
