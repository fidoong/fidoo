import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine, ToolRegistry } from "@fidoo/core";
import { bashTool, createCodingTools } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(result.verification).toMatchObject({ exitCode: 0 });
    expect(result.content).toContain("Succeeded");
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

  it("fails closed for high-risk commands in auto mode", () => {
    const registry = new ToolRegistry(createCodingTools());
    const bash = registry.get("bash");
    if (!bash) throw new Error("Missing bash");
    const auto = new PolicyEngine("auto");
    expect(auto.evaluate(bash, { command: "pnpm", args: ["test"] }).action).toBe("allow");
    expect(auto.evaluate(bash, { command: "git", args: ["push"] }).action).toBe("deny");
    expect(auto.evaluate(bash, { command: "node", args: ["-e", "process.exit(0)"] }).action).toBe(
      "deny",
    );
    expect(new PolicyEngine("read-only").evaluate(bash, { command: "node", args: [] }).action).toBe(
      "deny",
    );
  });
});
