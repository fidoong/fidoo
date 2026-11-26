export interface SubagentRequest {
  parentRunId: string;
  parentCallId: string;
  task: string;
  cwd: string;
  signal: AbortSignal;
  onStarted?(runId: string): void | Promise<void>;
}

export interface SubagentResult {
  runId: string;
  status: "completed" | "failed" | "blocked" | "cancelled";
  summary: string;
  error?: string;
}

export interface SubagentPort {
  run(request: SubagentRequest): Promise<SubagentResult>;
}
