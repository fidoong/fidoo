import { isVerificationCommand } from "../domain/verification.js";
import type { ToolDefinition, ToolRisk } from "../ports/tool.js";

export type PermissionMode = "ask" | "read-only" | "auto";

export interface PolicyDecision {
  action: "allow" | "ask" | "deny";
  risk: ToolRisk;
  reason: string;
}

export class PolicyEngine {
  constructor(private readonly mode: PermissionMode) {}

  evaluate(tool: ToolDefinition, input: unknown): PolicyDecision {
    const risk = effectiveRisk(tool, input);
    if (this.mode === "read-only" && tool.effect !== "read") {
      return {
        action: "deny",
        risk,
        reason: `Read-only mode denies ${tool.effect} operations`,
      };
    }
    if (risk === "low") {
      return { action: "allow", risk, reason: "Read-only low-risk operation" };
    }
    if (this.mode === "auto" && risk === "medium") {
      return { action: "allow", risk, reason: "Auto mode approved a medium-risk operation" };
    }
    if (this.mode === "auto" && risk === "high") {
      return { action: "deny", risk, reason: "Auto mode never approves high-risk operations" };
    }
    return {
      action: "ask",
      risk,
      reason:
        risk === "high"
          ? "High-risk operation requires explicit approval"
          : "Operation requires approval",
    };
  }
}

function effectiveRisk(tool: ToolDefinition, input: unknown): ToolRisk {
  if (tool.name !== "bash" || !isRecord(input)) {
    return tool.risk;
  }
  const command = typeof input.command === "string" ? input.command : "";
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (isVerificationCommand(command, args)) {
    return "medium";
  }
  return "high";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
