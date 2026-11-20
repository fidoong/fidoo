import type { AgentEvent } from "./events.js";
import type { Message, ToolCall } from "./messages.js";

export type RunStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";

export interface RunState {
  runId: string;
  task: string;
  cwd: string;
  status: RunStatus;
  messages: Message[];
  calls: Map<string, ToolCall>;
  results: Map<string, AgentEvent & { type: "tool.result" }>;
  changedFiles: Set<string>;
  lastMutationSeq: number;
  lastVerificationSeq: number;
  verificationAttempts: number;
  finalSummary?: string;
  error?: string;
}

export function emptyRunState(runId: string): RunState {
  return {
    runId,
    task: "",
    cwd: "",
    status: "running",
    messages: [],
    calls: new Map(),
    results: new Map(),
    changedFiles: new Set(),
    lastMutationSeq: 0,
    lastVerificationSeq: 0,
    verificationAttempts: 0,
  };
}

export function reduceEvent(state: RunState, event: AgentEvent): void {
  if (event.runId !== state.runId) {
    throw new Error(`Event ${event.eventId} belongs to another run`);
  }

  switch (event.type) {
    case "run.started":
      state.task = event.payload.task;
      state.cwd = event.payload.cwd;
      break;
    case "run.resumed":
      state.status = "running";
      delete state.finalSummary;
      delete state.error;
      break;
    case "message.user":
    case "message.assistant":
      state.messages.push(event.payload.message);
      break;
    case "tool.proposed":
      state.calls.set(event.payload.call.id, event.payload.call);
      break;
    case "tool.result": {
      const { result } = event.payload;
      state.results.set(result.callId, event);
      state.messages.push({
        role: "tool",
        toolCallId: result.callId,
        name: result.name,
        content: result.content,
        isError: result.status === "error",
      });
      for (const file of result.changedFiles ?? []) {
        state.changedFiles.add(file);
        state.lastMutationSeq = Math.max(state.lastMutationSeq, event.seq);
      }
      if (result.verification?.exitCode === 0) {
        state.lastVerificationSeq = Math.max(state.lastVerificationSeq, event.seq);
      }
      break;
    }
    case "verification.requested":
      state.verificationAttempts = event.payload.attempt;
      state.messages.push({
        role: "user",
        source: "harness",
        content: event.payload.reason,
      });
      break;
    case "run.completed":
      state.status = "completed";
      state.finalSummary = event.payload.summary;
      break;
    case "run.failed":
      state.status = "failed";
      state.error = event.payload.error;
      break;
    case "run.blocked":
      state.status = "blocked";
      state.finalSummary = event.payload.reason;
      state.error = event.payload.reason;
      break;
    case "run.cancelled":
      state.status = "cancelled";
      state.error = event.payload.reason;
      break;
    case "model.usage":
    case "tool.approval_required":
    case "tool.decided":
    case "tool.started":
    case "verification.finished":
      break;
  }
}

export function replayRun(runId: string, events: AgentEvent[]): RunState {
  const state = emptyRunState(runId);
  let expectedSeq = 1;
  for (const event of events) {
    if (event.seq !== expectedSeq) {
      throw new Error(`Invalid event sequence: expected ${expectedSeq}, received ${event.seq}`);
    }
    reduceEvent(state, event);
    expectedSeq += 1;
  }
  return state;
}

export function needsVerification(state: RunState): boolean {
  return state.lastMutationSeq > state.lastVerificationSeq;
}
