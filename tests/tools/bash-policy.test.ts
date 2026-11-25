import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine, ToolRegistry } from "@fidoo/core";
import { bashTool, createCodingTools } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("command execution and policy", () => {
  it("runs real tests without shell expansion and records verification", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    await writeFile(
      join(cwd, "ok.test.mjs"),
      'import assert from "node:assert/strict";\nassert.equal(2 + 2, 4);\n',
    );
    const result = await executeTool(
      bashTool,
      { command: "node", args: ["--test", "ok.test.mjs"] },
      { cwd },
    );
    expect(result.verification).toMatchObject({
      kind: "test",
      status: "passed",
      exitCode: 0,
      args: ["--test", "ok.test.mjs"],
    });
    expect(result.verification?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.content).toContain("Succeeded");
    expect(result.content).toContain("Verification:");
  });

  it("classifies failed tests without losing the original output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    await writeFile(
      join(cwd, "fail.test.mjs"),
      'import assert from "node:assert/strict";\nassert.equal(2 + 2, 5);\n',
    );
    const result = await executeTool(
      bashTool,
      { command: "node", args: ["--test", "fail.test.mjs"] },
      { cwd },
    );
    expect(result.success).toBe(false);
    expect(result.verification).toMatchObject({
      kind: "test",
      status: "failed",
      failure: "test",
      exitCode: 1,
    });
    expect(result.content).toContain("AssertionError");
  });

  it("marks non-zero exits as failures and preserves diagnostic details", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    const result = await executeTool(
      bashTool,
      {
        command: "node",
        args: ["-e", "process.stderr.write('specific failure'); process.exit(1)"],
      },
      { cwd },
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("exit code 1");
    expect(result.content).toContain("specific failure");
  });

  it("passes shell metacharacters as literal arguments", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    const result = await executeTool(
      bashTool,
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1])", "$HOME && pwd"],
      },
      { cwd },
    );
    expect(result.content).toContain("$HOME && pwd");
  });

  it("streams stdout and stderr before the command completes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    let completed = false;
    let streamed = "";
    const pending = executeTool(
      bashTool,
      {
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('early'); setTimeout(() => process.stderr.write('later'), 100)",
        ],
      },
      {
        cwd,
        onOutput: (text) => {
          streamed += text;
        },
      },
    ).finally(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(streamed).toContain("early"));
    expect(completed).toBe(false);
    await pending;
    expect(streamed).toContain("later");
  });

  it("terminates the process group when a command is cancelled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-bash-"));
    directories.push(cwd);
    const controller = new AbortController();
    let childPid = 0;
    const result = await executeTool(
      bashTool,
      {
        command: process.execPath,
        args: [
          "-e",
          "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); process.stdout.write(String(child.pid)); setInterval(() => {}, 1000)",
        ],
      },
      {
        cwd,
        signal: controller.signal,
        onOutput: (text) => {
          childPid = Number(text.trim());
          if (childPid > 0) controller.abort();
        },
      },
    );
    expect(result.success).toBe(false);
    expect(childPid).toBeGreaterThan(0);
    try {
      await vi.waitFor(() => expect(processAlive(childPid)).toBe(false));
    } finally {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
  });

  it("requires model review for non-low-risk commands in auto mode", () => {
    const registry = new ToolRegistry(createCodingTools());
    const bash = registry.get("bash");
    if (!bash) throw new Error("Missing bash");
    const auto = new PolicyEngine("auto");
    expect(auto.evaluate(bash, { command: "pnpm", args: ["test"] })).toMatchObject({
      action: "ask",
      requiresReview: true,
    });
    expect(auto.evaluate(bash, { command: "git", args: ["push"] })).toMatchObject({
      action: "ask",
      requiresReview: true,
    });
    expect(auto.evaluate(bash, { command: "node", args: ["-e", "process.exit(0)"] })).toMatchObject(
      { action: "ask", requiresReview: true },
    );
    expect(new PolicyEngine("read-only").evaluate(bash, { command: "node", args: [] }).action).toBe(
      "deny",
    );
  });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
