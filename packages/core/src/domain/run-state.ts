import type { PermissionMode } from "../runtime/policy-engine.js";
import type { AgentEvent } from "./events.js";
import type { Message, ToolCall } from "./messages.js";
import type { TaskPlan } from "./plan.js";
import type { RequiredCheck, VerificationEvidence } from "./verification.js";
import {
  selectRequiredChecks,
  successfulVerification,
  verificationMatchesCheck,
} from "./verification.js";

export interface RecordedVerification extends VerificationEvidence {
  seq: number;
}

export interface VerificationReport {
  required: boolean;
  passed: boolean;
  evidence: RecordedVerification[];
  pendingChecks: RequiredCheck[];
}

export type RunStatus =
  | "running"
  | "awaiting_plan"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface RunState {
  runId: string;
  task: string;
  cwd: string;
  status: RunStatus;
  permissionMode: PermissionMode;
  dontAsk: boolean;
  bypassPermissions: boolean;
  messages: Message[];
  calls: Map<string, ToolCall>;
  results: Map<string, AgentEvent & { type: "tool.result" }>;
  plan?: TaskPlan;
  steeringRequests: Map<string, string>;
  changedFiles: Set<string>;
  lastMutationSeq: number;
  lastVerificationSeq: number;
  verifications: RecordedVerification[];
  verificationAttempts: number;
  tokenEstimateRatio: number;
  lastEstimatedInputTokens: number;
  finalSummary?: string;
  error?: string;
}

export function emptyRunState(runId: string): RunState {
  return {
    runId,
    task: "",
    cwd: "",
    status: "running",
    permissionMode: "manual",
    dontAsk: false,
    bypassPermissions: false,
    messages: [],
    calls: new Map(),
    results: new Map(),
    steeringRequests: new Map(),
    changedFiles: new Set(),
    lastMutationSeq: 0,
    lastVerificationSeq: 0,
    verifications: [],
    verificationAttempts: 0,
    tokenEstimateRatio: 1,
    lastEstimatedInputTokens: 0,
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
      state.permissionMode = event.payload.permissionMode ?? "manual";
      state.dontAsk = event.payload.dontAsk ?? false;
      state.bypassPermissions = event.payload.bypassPermissions ?? false;
      break;
    case "run.resumed":
      state.status = "running";
      delete state.finalSummary;
      delete state.error;
      break;
    case "message.user":
      if (event.payload.steeringId) {
        state.steeringRequests.delete(event.payload.steeringId);
      }
      state.messages.push(event.payload.message);
      break;
    case "message.assistant":
      state.messages.push(event.payload.message);
      break;
    case "context.compacted": {
      const recent =
        event.payload.retainedMessages === 0
          ? []
          : state.messages.slice(-event.payload.retainedMessages);
      state.messages = [event.payload.summary, ...recent];
      break;
    }
    case "plan.updated":
      state.plan = event.payload.plan;
      break;
    case "mode.changed":
      state.permissionMode = event.payload.mode;
      break;
    case "plan.awaiting_approval":
      state.status = "awaiting_plan";
      break;
    case "plan.approved":
    case "plan.rejected":
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
        ...(result.images ? { images: result.images } : {}),
      });
      for (const file of result.changedFiles ?? []) {
        state.changedFiles.add(file);
        state.lastMutationSeq = Math.max(state.lastMutationSeq, event.seq);
      }
      const evidence = [result.verification, ...(result.verifications ?? [])].filter(
        (item) => item !== undefined,
      );
      for (const item of evidence) {
        state.verifications.push({ ...item, seq: event.seq });
        if (successfulVerification(item)) {
          state.lastVerificationSeq = Math.max(state.lastVerificationSeq, event.seq);
        }
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
    case "run.steered":
      state.steeringRequests.set(event.payload.instructionId, event.payload.task);
      break;
    case "model.started":
      state.lastEstimatedInputTokens = event.payload.estimatedInputTokens ?? 0;
      break;
    case "model.usage":
      if (state.lastEstimatedInputTokens > 0) {
        state.tokenEstimateRatio = Math.min(
          4,
          Math.max(0.5, event.payload.inputTokens / state.lastEstimatedInputTokens),
        );
      }
      break;
    case "model.completed":
    case "model.failed":
    case "permission.review.started":
    case "permission.review.completed":
    case "permission.review.failed":
    case "tool.approval_required":
    case "tool.decided":
    case "tool.started":
    case "user_input.required":
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

export function verificationReport(
  state: RunState,
  requiredChecks: readonly RequiredCheck[] = [],
): VerificationReport {
  if (state.lastMutationSeq === 0) {
    return { required: false, passed: true, evidence: [], pendingChecks: [] };
  }
  const current = state.verifications.filter((item) => item.seq >= state.lastMutationSeq);
  const checks = selectRequiredChecks(requiredChecks, state.changedFiles);
  if (checks.length > 0) {
    const evidence = checks
      .map((check) => current.findLast((item) => verificationMatchesCheck(item, check)))
      .filter((item) => item !== undefined);
    const pendingChecks = checks.filter((check) => {
      const latest = current.findLast((item) => verificationMatchesCheck(item, check));
      return !latest || !successfulVerification(latest);
    });
    return { required: true, passed: pendingChecks.length === 0, evidence, pendingChecks };
  }
  if (requiredChecks.length > 0) {
    return { required: false, passed: true, evidence: [], pendingChecks: [] };
  }
  const latest = current.at(-1);
  return {
    required: true,
    passed: latest !== undefined && successfulVerification(latest),
    evidence: latest ? [latest] : [],
    pendingChecks: [],
  };
}

export function needsVerification(
  state: RunState,
  requiredChecks: readonly RequiredCheck[] = [],
): boolean {
  return !verificationReport(state, requiredChecks).passed;
}
