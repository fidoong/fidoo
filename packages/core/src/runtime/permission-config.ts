import { z } from "zod";
import type { ToolEffect, ToolRisk } from "../ports/tool.js";
import type { PermissionMode } from "./policy-engine.js";

export const permissionRuleSchema = z
  .object({
    action: z.enum(["allow", "ask", "deny"]),
    tools: z.array(z.string().min(1)).min(1).optional(),
    effects: z
      .array(z.enum(["read", "write", "execute", "network"]))
      .min(1)
      .optional(),
    risks: z
      .array(z.enum(["low", "medium", "high"]))
      .min(1)
      .optional(),
    commands: z.array(z.string().min(1)).min(1).optional(),
    paths: z.array(z.string().min(1)).min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (rule) => Boolean(rule.tools || rule.effects || rule.risks || rule.commands || rule.paths),
    { message: "Permission rule must include at least one selector" },
  );

export const permissionConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    mode: z.enum(["read-only", "manual", "plan", "acceptEdits", "auto"]).optional(),
    rules: z.array(permissionRuleSchema).default([]),
  })
  .strict();

export type PermissionRule = z.infer<typeof permissionRuleSchema>;
export type PermissionConfig = z.infer<typeof permissionConfigSchema>;
export type ResolvedPermissionRule = PermissionRule & { source?: string };

export interface ResolvedPermissionPolicy {
  mode: PermissionMode | undefined;
  rules: ResolvedPermissionRule[];
  sources: string[];
}

export type PermissionEffect = ToolEffect;
export type PermissionRisk = ToolRisk;
