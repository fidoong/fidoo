import { isVerificationCommand } from "../domain/verification.js";
import type { ToolDefinition, ToolRisk } from "../ports/tool.js";
import type { ResolvedPermissionRule } from "./permission-config.js";

export type PermissionMode = "ask" | "read-only" | "auto";

export interface PolicyDecision {
  action: "allow" | "ask" | "deny";
  risk: ToolRisk;
  reason: string;
}

export class PolicyEngine {
  constructor(
    private readonly mode: PermissionMode,
    private readonly rules: ResolvedPermissionRule[] = [],
  ) {}

  evaluate(tool: ToolDefinition, input: unknown): PolicyDecision {
    const risk = effectiveRisk(tool, input);
    if (this.mode === "read-only" && tool.effect !== "read") {
      return {
        action: "deny",
        risk,
        reason: `Read-only mode denies ${tool.effect} operations`,
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
