import { z } from "zod";

export const PROTOCOL_VERSION = "v1" as const;

export const PUBLIC_RUN_EVENT_TYPES = [
  "run.started",
  "run.resumed",
  "run.steered",
  "message.user",
  "message.assistant",
  "message.assistant.delta",
  "message.reasoning.delta",
  "model.started",
  "model.completed",
  "model.failed",
  "context.compacted",
  "plan.updated",
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
] as const;

export const publicRunEventTypeSchema = z.enum(PUBLIC_RUN_EVENT_TYPES);
export type PublicRunEventType = z.infer<typeof publicRunEventTypeSchema>;

export const publicRunEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  eventId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: publicRunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;

export const TRANSIENT_RUN_EVENT_TYPES = [
  "message.assistant.delta",
  "message.reasoning.delta",
] as const;

export function isTransientRunEvent(event: PublicRunEvent): boolean {
  return TRANSIENT_RUN_EVENT_TYPES.includes(
    event.type as (typeof TRANSIENT_RUN_EVENT_TYPES)[number],
  );
}

export const TERMINAL_RUN_EVENT_TYPES = [
  "run.completed",
  "run.failed",
  "run.blocked",
  "run.cancelled",
] as const;

export function isTerminalRunEvent(event: PublicRunEvent): boolean {
  return TERMINAL_RUN_EVENT_TYPES.includes(event.type as (typeof TERMINAL_RUN_EVENT_TYPES)[number]);
}
