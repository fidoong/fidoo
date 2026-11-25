import { randomUUID } from "node:crypto";
import type { AgentEvent, RunState, RunSummary } from "@fidoo/core";
import type { PublicRunEvent, RunSnapshot } from "@fidoo/protocol";
import { PROTOCOL_VERSION } from "@fidoo/protocol";

export function toPublicRunEvent(event: AgentEvent): PublicRunEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: event.runId,
    seq: event.seq,
    eventId: event.eventId,
    timestamp: event.timestamp,
    type: event.type,
    payload: publicPayload(event),
  };
}

export function toAssistantDelta(runId: string, seq: number, text: string): PublicRunEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId,
    seq,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "message.assistant.delta",
    payload: { text },
  };
}

export function toReasoningDelta(runId: string, seq: number, text: string): PublicRunEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId,
    seq,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "message.reasoning.delta",
    payload: { text },
  };
}

export function toToolOutputDelta(
  runId: string,
  seq: number,
  callId: string,
  text: string,
): PublicRunEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId,
    seq,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "tool.output.delta",
    payload: { callId, text },
  };
}

export function toPublicSnapshot(state: RunState): RunSnapshot {
  return {
    runId: state.runId,
    task: state.task,
    cwd: state.cwd,
    status: state.status,
    permissionMode: state.permissionMode,
    dontAsk: state.dontAsk,
    bypassPermissions: state.bypassPermissions,
    changedFiles: [...state.changedFiles],
    verified: state.lastMutationSeq > 0 && state.lastVerificationSeq >= state.lastMutationSeq,
    ...(state.finalSummary !== undefined ? { finalSummary: state.finalSummary } : {}),
    ...(state.error !== undefined ? { error: state.error } : {}),
  };
}

export function toPublicSummary(summary: RunSummary) {
  return { ...summary };
}

function publicPayload(event: AgentEvent): Record<string, unknown> {
  if (event.type === "message.assistant") {
    const { reasoningContent: _reasoningContent, ...message } = event.payload.message;
    return { message };
  }
  return { ...event.payload };
}
