import type { AssistantMessage, ToolCall, ToolObservation, UserMessage } from "./messages.js";

export const EVENT_SCHEMA_VERSION = 1 as const;

interface EventBase<Type extends string, Payload> {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
  type: Type;
  payload: Payload;
}

export type AgentEvent =
  | EventBase<"run.started", { task: string; cwd: string }>
  | EventBase<"run.resumed", { reason: string }>
  | EventBase<"message.user", { message: UserMessage }>
  | EventBase<"message.assistant", { message: AssistantMessage }>
  | EventBase<"model.usage", { inputTokens: number; outputTokens: number }>
  | EventBase<"tool.proposed", { call: ToolCall }>
  | EventBase<
      "tool.approval_required",
      { callId: string; risk: "low" | "medium" | "high"; reason: string }
    >
  | EventBase<"tool.decided", { callId: string; decision: "approved" | "rejected"; reason: string }>
  | EventBase<"tool.started", { callId: string }>
  | EventBase<"tool.result", { result: ToolObservation }>
  | EventBase<"verification.requested", { reason: string; attempt: number }>
  | EventBase<"verification.finished", { success: boolean; evidence: string }>
  | EventBase<"run.completed", { summary: string; verification: "passed" | "not-required" }>
  | EventBase<"run.failed", { error: string; recoverable: boolean }>
  | EventBase<"run.blocked", { reason: string }>
  | EventBase<"run.cancelled", { reason: string }>;

export type EventType = AgentEvent["type"];
export type EventPayload<Type extends EventType> = Extract<AgentEvent, { type: Type }>["payload"];

export interface EventMetadata {
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
}

export function createEvent<Type extends EventType>(
  metadata: EventMetadata,
  type: Type,
  payload: EventPayload<Type>,
): Extract<AgentEvent, { type: Type }> {
  return {
    ...metadata,
    schemaVersion: EVENT_SCHEMA_VERSION,
    type,
    payload,
  } as Extract<AgentEvent, { type: Type }>;
}

export const EVENT_TYPES = [
  "run.started",
  "run.resumed",
  "message.user",
  "message.assistant",
  "model.usage",
  "tool.proposed",
  "tool.approval_required",
  "tool.decided",
  "tool.started",
  "tool.result",
  "verification.requested",
  "verification.finished",
  "run.completed",
  "run.failed",
  "run.blocked",
  "run.cancelled",
] as const satisfies readonly EventType[];
