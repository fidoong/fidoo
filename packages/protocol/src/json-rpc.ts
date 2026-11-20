import { z } from "zod";
import { PROTOCOL_VERSION, publicRunEventSchema } from "./events.js";

export const JSON_RPC_VERSION = "2.0" as const;

const envelope = {
  jsonrpc: z.literal(JSON_RPC_VERSION),
  protocolVersion: z.literal(PROTOCOL_VERSION),
};

export const jsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z
    .object({
      agentCode: z.string().optional(),
      protocolVersion: z.string().optional(),
    })
    .optional(),
});
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>;

export const jsonRpcRequestSchema = z.object({
  ...envelope,
  requestId: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcResponseSchema = z.union([
  z.object({
    ...envelope,
    requestId: z.string().min(1),
    result: z.unknown(),
  }),
  z.object({
    ...envelope,
    requestId: z.string().min(1),
    error: jsonRpcErrorSchema,
  }),
]);
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

export const runSubscribeResultSchema = z.object({ subscriptionId: z.string().min(1) });
export type RunSubscribeResult = z.infer<typeof runSubscribeResultSchema>;

export const runEventNotificationSchema = z.object({
  ...envelope,
  method: z.literal("run.event"),
  params: z.object({
    subscriptionId: z.string().min(1),
    event: publicRunEventSchema,
  }),
});
export type RunEventNotification = z.infer<typeof runEventNotificationSchema>;

export const runEndNotificationSchema = z.object({
  ...envelope,
  method: z.literal("run.end"),
  params: z.object({
    subscriptionId: z.string().min(1),
    error: jsonRpcErrorSchema.optional(),
  }),
});
export type RunEndNotification = z.infer<typeof runEndNotificationSchema>;

export const subscriptionCloseNotificationSchema = z.object({
  ...envelope,
  method: z.literal("subscription.close"),
  params: z.object({ subscriptionId: z.string().min(1) }),
});
export type SubscriptionCloseNotification = z.infer<typeof subscriptionCloseNotificationSchema>;
