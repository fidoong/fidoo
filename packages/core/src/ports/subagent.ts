export interface SubagentRequest {
  parentRunId: string;
  task: string;
  cwd: string;
  signal: AbortSignal;
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
