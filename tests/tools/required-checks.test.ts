import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RequiredCheck, type ToolDefinition, ToolRegistry } from "@fidoo/core";
import { createCodingTools, revisionOf, WorkspaceChangeManager } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const checks: RequiredCheck[] = [
  {
    id: "unit",
    command: "node",
    args: ["--test", "unit.test.mjs"],
    paths: ["src/**"],
  },
  {
    id: "integration",
    command: "node",
    args: ["--test", "integration.test.mjs"],
    paths: ["src/**"],
  },
];

describe("required checks tool", () => {
  it("runs every affected check and returns separate structured evidence", async () => {
    const { cwd, tools } = await workspace(true);
    await edit(cwd, tools);
    const result = await executeTool(
      required(tools.get("run_required_checks")),
      {},
      { cwd, runId: "run-1" },
    );
    expect(result.success).toBe(true);
    expect(result.verifications).toHaveLength(2);
    expect(result.verifications?.map((evidence) => evidence.checkId)).toEqual([
      "unit",
      "integration",
    ]);
    expect(result.verifications?.every((evidence) => evidence.status === "passed")).toBe(true);
  });

  it("keeps failure diagnostics and does not mark the batch as passed", async () => {
    const { cwd, tools } = await workspace(false);
    await edit(cwd, tools);
    const result = await executeTool(
      required(tools.get("run_required_checks")),
      { checkIds: ["unit", "integration"] },
      { cwd, runId: "run-1" },
    );
    expect(result.success).toBe(false);
    expect(result.verifications).toMatchObject([
      { checkId: "unit", status: "passed" },
      { checkId: "integration", status: "failed", failure: "test" },
    ]);
    expect(result.content).toContain("integration failure");
  });

  it("does not execute checks when no scoped files changed", async () => {
    const { cwd, tools } = await workspace(true);
    const result = await executeTool(
      required(tools.get("run_required_checks")),
      {},
      { cwd, runId: "run-1" },
    );
    expect(result.content).toContain("not-required");
    expect(result.verifications).toBeUndefined();
  });
});

async function workspace(passing: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "required-checks-"));
  directories.push(cwd);
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(join(cwd, "src/value.ts"), "export const value = true;\n");
  await writeFile(
    join(cwd, "unit.test.mjs"),
    "import assert from 'node:assert/strict'; assert.ok(true);\n",
  );
  await writeFile(
    join(cwd, "integration.test.mjs"),
    passing
      ? "import assert from 'node:assert/strict'; assert.ok(true);\n"
      : "import assert from 'node:assert/strict'; assert.fail('integration failure');\n",
  );
  const changes = new WorkspaceChangeManager();
  return { cwd, tools: new ToolRegistry(createCodingTools(undefined, checks, changes)) };
}

async function edit(cwd: string, tools: ToolRegistry) {
  await executeTool(
    required(tools.get("edit_file")),
    {
      path: "src/value.ts",
      old_string: "true",
      new_string: "false",
      expected_revision: revisionOf("export const value = true;\n"),
    },
    { cwd, runId: "run-1" },
  );
}

function required(tool: ToolDefinition | undefined): ToolDefinition {
  if (!tool) throw new Error("Missing tool");
  return tool;
}
