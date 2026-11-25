import type {
  ArtifactReference,
  BackgroundTask,
  PermissionMode,
  UserInputQuestion,
} from "@fidoo/protocol";

export type TuiPhase =
  | "idle"
  | "starting"
  | "running"
  | "awaiting_plan"
  | "awaiting_approval"
  | "awaiting_input"
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
  startedAt?: number;
  durationMs?: number;
  artifacts?: ArtifactReference[] | undefined;
}

export interface PendingApproval {
  runId: string;
  call: ViewToolCall;
  risk: "low" | "medium" | "high";
  reason: string;
}

export interface PendingUserInput {
  callId: string;
  questions: UserInputQuestion[];
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
  permissionMode: PermissionMode;
  dontAsk: boolean;
  bypassPermissions: boolean;
  reviewingTool: string | undefined;
  pendingPlan: { planId: string; requestedMode: PermissionMode } | undefined;
  messages: ViewMessage[];
  streamingText: string;
  streamingBlocksStarted: boolean;
  responseActive: boolean;
  responseStartIndex: number | undefined;
  reasoningText: string;
  reasoningActive: boolean;
  reasoningStartedAt: number | undefined;
  reasoningEndedAt: number | undefined;
  reasoningMessageId: string | undefined;
  tools: ToolCard[];
  taskPlan: ViewTaskPlan | undefined;
  pendingApproval: PendingApproval | undefined;
  pendingInput: PendingUserInput | undefined;
  changedFiles: string[];
  verificationStatus: "running" | "passed" | "failed" | "not-required" | undefined;
  usage: {
    inputTokens: number;
    outputTokens: number;
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  contextTokens: number;
  modelActivity: {
    active: boolean;
    calls: number;
    durationMs: number;
    failures: number;
    iteration: number;
    startedAt: number | undefined;
  };
  steeringPending: number;
  backgroundTasks: BackgroundTask[];
  lastSeq: number;
  notice: string | undefined;
  error: string | undefined;
}
