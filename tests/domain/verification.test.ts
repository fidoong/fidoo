import {
  classifyVerification,
  classifyVerificationFailure,
  formatVerificationEvidence,
  isVerificationCommand,
  requiredCheckForCommand,
  selectRequiredChecks,
} from "@fidoo/core";
import { describe, expect, it } from "vitest";

describe("structured verification", () => {
  it("classifies package manager and direct verification commands", () => {
    expect(classifyVerification("pnpm", ["test"])).toBe("test");
    expect(classifyVerification("pnpm", ["exec", "tsc"])).toBe("typecheck");
    expect(classifyVerification("npm", ["run", "lint"])).toBe("lint");
    expect(classifyVerification("cargo", ["build"])).toBe("build");
    expect(classifyVerification("node", ["--test", "a.test.mjs"])).toBe("test");
    expect(isVerificationCommand("node", ["-e", "process.exit(0)"])).toBe(false);
  });

  it("distinguishes environment and timeout failures from test failures", () => {
    expect(classifyVerificationFailure("test", 1, "assertion failed", false)).toBe("test");
    expect(classifyVerificationFailure("test", 127, "command not found", false)).toBe(
      "environment",
    );
    expect(classifyVerificationFailure("build", 1, "Cannot find module", false)).toBe(
      "environment",
    );
    expect(classifyVerificationFailure("lint", 1, "slow", true)).toBe("timeout");
    expect(classifyVerificationFailure("check", 1, "invalid", false)).toBe("command");
    expect(classifyVerificationFailure("test", 0, "", false)).toBeUndefined();
  });

  it("matches required commands exactly and selects them by changed paths", () => {
    const checks = [
      {
        id: "src-tests",
        command: "node",
        args: ["--test", "src.test.mjs"],
        paths: ["src/**"],
      },
      {
        id: "docs-check",
        command: "node",
        args: ["--test", "docs.test.mjs"],
        paths: ["docs/**"],
      },
    ];
    expect(requiredCheckForCommand(checks, "node", ["--test", "src.test.mjs"], ".")?.id).toBe(
      "src-tests",
    );
    expect(requiredCheckForCommand(checks, "node", ["--test"], ".")).toBeUndefined();
    expect(
      selectRequiredChecks(checks, new Set(["src/nested/a.ts"])).map((check) => check.id),
    ).toEqual(["src-tests"]);
  });

  it("formats evidence with the real command, result and duration", () => {
    expect(
      formatVerificationEvidence({
        checkId: "unit",
        command: '"node" "--test"',
        exitCode: 0,
        kind: "test",
        status: "passed",
        durationMs: 42,
      }),
    ).toBe('unit: passed ("node" "--test", exit 0, 42ms)');
  });
});
