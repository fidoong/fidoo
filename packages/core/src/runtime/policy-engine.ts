import { isVerificationCommand } from "../domain/verification.js";
import type { ToolDefinition, ToolRisk } from "../ports/tool.js";
import type { ResolvedPermissionRule } from "./permission-config.js";

export type PermissionMode = "read-only" | "manual" | "plan" | "acceptEdits" | "auto";

export interface PolicyDecision {
  action: "allow" | "ask" | "deny";
  risk: ToolRisk;
  reason: string;
  requiresReview?: boolean;
}

export class PolicyEngine {
  constructor(
    private readonly mode: PermissionMode,
    private readonly rules: ResolvedPermissionRule[] = [],
  ) {}

  evaluate(
    tool: ToolDefinition,
    input: unknown,
    mode: PermissionMode = this.mode,
    bypassPermissions = false,
  ): PolicyDecision {
    const risk = effectiveRisk(tool, input);
    if (mode === "read-only" && tool.effect !== "read") {
      return {
        action: "deny",
        risk,
        reason: `Read-only mode denies ${tool.effect} operations`,
      };
    }
    if (mode === "plan" && tool.effect !== "read" && !isPlanReadOnlyCommand(input)) {
      return {
        action: "deny",
        risk,
        reason: "Plan mode only allows read-only exploration and planning",
      };
    }
    for (let index = this.rules.length - 1; index >= 0; index -= 1) {
      const rule = this.rules[index];
      if (rule && matchesRule(rule, tool, input, risk)) {
        const source = rule.source ? `${rule.source} ` : "";
        return {
          action: rule.action,
          risk,
          reason: `${source}rule ${index + 1}: ${rule.reason ?? `${rule.action} ${tool.name}`}`,
        };
      }
    }
    if (bypassPermissions) {
      return { action: "allow", risk, reason: "Bypass permissions approved an isolated action" };
    }
    if (mode === "plan") {
      return { action: "allow", risk, reason: "Plan mode approved a read-only command" };
    }
    if (risk === "low") {
      return { action: "allow", risk, reason: "Read-only low-risk operation" };
    }
    if (mode === "acceptEdits" && isWorkspaceEdit(tool)) {
      return { action: "allow", risk, reason: "Accept Edits mode approved a workspace edit" };
    }
    if (mode === "auto") {
      return {
        action: "ask",
        risk,
        requiresReview: true,
        reason: "Auto mode requires model review",
      };
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

function matchesRule(
  rule: ResolvedPermissionRule,
  tool: ToolDefinition,
  input: unknown,
  risk: ToolRisk,
): boolean {
  if (rule.tools && !rule.tools.includes("*") && !rule.tools.includes(tool.name)) {
    return false;
  }
  if (rule.effects && !rule.effects.includes(tool.effect)) {
    return false;
  }
  if (rule.risks && !rule.risks.includes(risk)) {
    return false;
  }
  const record = isRecord(input) ? input : {};
  if (rule.commands) {
    if (tool.name !== "bash") {
      return false;
    }
    const command = typeof record.command === "string" ? record.command : "";
    const args = Array.isArray(record.args)
      ? record.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const value = [command, ...args].join(" ");
    if (!rule.commands.some((pattern) => matchesGlob(value, pattern, false))) {
      return false;
    }
  }
  if (rule.paths) {
    const path = typeof record.path === "string" ? normalizePath(record.path) : undefined;
    if (!path || !rule.paths.some((pattern) => matchesGlob(path, normalizePath(pattern), true))) {
      return false;
    }
  }
  return true;
}

function matchesGlob(value: string, pattern: string, pathMode: boolean): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pathMode && pattern[index + 1] === "/") {
          expression += "(?:.*/)?";
          index += 1;
        } else {
          expression += ".*";
        }
      } else {
        expression += pathMode ? "[^/]*" : ".*";
      }
    } else if (char === "?") {
      expression += pathMode ? "[^/]" : ".";
    } else {
      expression += char && "\\.^$+()[]{}|".includes(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`${expression}$`).test(value);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isWorkspaceEdit(tool: ToolDefinition): boolean {
  return tool.effect === "write" && tool.name !== "undo_file" && tool.name !== "undo_run";
}

function isPlanReadOnlyCommand(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const command = typeof input.command === "string" ? input.command : "";
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (["pwd", "ls", "cat", "head", "tail", "grep", "wc", "which", "stat", "du"].includes(command)) {
    return true;
  }
  return (
    command === "git" && ["status", "diff", "log", "show", "rev-parse"].includes(args[0] ?? "")
  );
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
