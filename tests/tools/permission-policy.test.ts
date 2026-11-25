import { PolicyEngine, ToolRegistry } from "@fidoo/core";
import { createCodingTools } from "@fidoo/node-runtime";
import { describe, expect, it } from "vitest";

const registry = new ToolRegistry(createCodingTools());

describe("configurable permission rules", () => {
  it("allows an explicit high-risk command without opening every high-risk command", () => {
    const policy = new PolicyEngine("auto", [
      {
        action: "allow",
        tools: ["bash"],
        commands: ["git status"],
        reason: "Reading repository state is safe here",
      },
    ]);
    expect(evaluateBash(policy, "git", ["status"])).toMatchObject({ action: "allow" });
    expect(evaluateBash(policy, "git", ["push"])).toMatchObject({
      action: "ask",
      requiresReview: true,
    });
    expect(evaluateBash(policy, "node", ["script.js"])).toMatchObject({
      action: "ask",
      requiresReview: true,
    });
  });

  it("uses the last matching rule across command selectors", () => {
    const policy = new PolicyEngine("auto", [
      { action: "allow", tools: ["bash"], commands: ["git *"] },
      { action: "deny", tools: ["bash"], commands: ["git push*"], reason: "No remote writes" },
    ]);
    expect(evaluateBash(policy, "git", ["status"])).toMatchObject({ action: "allow" });
    const decision = evaluateBash(policy, "git", ["push", "origin", "main"]);
    expect(decision).toMatchObject({ action: "deny" });
    expect(decision.reason).toContain("No remote writes");
  });

  it("matches workspace paths including root files with ** patterns", () => {
    const edit = registry.get("edit_file");
    if (!edit) throw new Error("Missing edit_file");
    const policy = new PolicyEngine("manual", [
      { action: "allow", tools: ["edit_file"], paths: ["**/*.test.ts"] },
      { action: "deny", tools: ["edit_file"], paths: ["src/generated/**"] },
    ]);
    expect(policy.evaluate(edit, { path: "math.test.ts" }).action).toBe("allow");
    expect(policy.evaluate(edit, { path: "tests/math.test.ts" }).action).toBe("allow");
    expect(policy.evaluate(edit, { path: "src/value.ts" }).action).toBe("ask");
    expect(policy.evaluate(edit, { path: "src/generated/value.test.ts" }).action).toBe("deny");
  });

  it("keeps read-only as a hard boundary even when a rule allows a write", () => {
    const write = registry.get("write_file");
    if (!write) throw new Error("Missing write_file");
    const policy = new PolicyEngine("read-only", [
      { action: "allow", tools: ["write_file"], paths: ["src/**"] },
    ]);
    expect(policy.evaluate(write, { path: "src/value.ts" })).toMatchObject({ action: "deny" });
  });

  it("combines effect, risk, tool and command selectors with AND semantics", () => {
    const policy = new PolicyEngine("auto", [
      {
        action: "ask",
        effects: ["execute"],
        risks: ["medium"],
        tools: ["bash"],
        commands: ["pnpm *"],
      },
    ]);
    expect(evaluateBash(policy, "pnpm", ["test"])).toMatchObject({ action: "ask" });
    expect(evaluateBash(policy, "npm", ["test"])).toMatchObject({
      action: "ask",
      requiresReview: true,
    });
  });
});

function evaluateBash(policy: PolicyEngine, command: string, args: string[]) {
  const bash = registry.get("bash");
  if (!bash) throw new Error("Missing bash");
  return policy.evaluate(bash, { command, args });
}
