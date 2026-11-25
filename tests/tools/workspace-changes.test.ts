import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolDefinition, ToolRegistry } from "@fidoo/core";
import { createCodingTools, revisionOf, WorkspaceChangeManager } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace change tracking", () => {
  it("records unified diffs for edits and newly created empty files", async () => {
    const { cwd, changes } = await workspace("const value = true;\n");
    const tools = new ToolRegistry(createCodingTools(undefined, [], changes));
    await executeTool(
      required(tools.get("edit_file")),
      {
        path: "value.ts",
        old_string: "true",
        new_string: "false",
        expected_revision: revision("const value = true;\n"),
      },
      { cwd, runId: "run-1" },
    );
    await executeTool(
      required(tools.get("write_file")),
      { path: "empty.txt", content: "" },
      { cwd, runId: "run-1" },
    );
    const status = await executeTool(
      required(tools.get("workspace_status")),
      {},
      { cwd, runId: "run-1" },
    );
    const parsed = JSON.parse(status.content);
    expect(parsed.files).toBe(2);
    expect(parsed.changes).toMatchObject([
      { path: "empty.txt", status: "added", canUndo: true },
      { path: "value.ts", status: "modified", addedLines: 1, deletedLines: 1, canUndo: true },
    ]);
    const diff = await executeTool(
      required(tools.get("workspace_diff")),
      { paths: ["value.ts"] },
      { cwd, runId: "run-1" },
    );
    expect(diff.content).toContain("@@ -1,1 +1,1 @@");
    expect(diff.content).toContain("-const value = true;");
    expect(diff.content).toContain("+const value = false;");
  });

  it("reloads snapshots in a new manager and detects external changes", async () => {
    const { cwd, home, changes } = await workspace("before\n");
    const tools = new ToolRegistry(createCodingTools(undefined, [], changes));
    await executeTool(
      required(tools.get("edit_file")),
      {
        path: "value.ts",
        old_string: "before",
        new_string: "after",
        expected_revision: revision("before\n"),
      },
      { cwd, runId: "persisted-run" },
    );
    const restarted = new WorkspaceChangeManager(home);
    const restartedTools = new ToolRegistry(createCodingTools(undefined, [], restarted));
    const status = await executeTool(
      required(restartedTools.get("workspace_status")),
      {},
      { cwd, runId: "persisted-run" },
    );
    expect(JSON.parse(status.content).changes[0]).toMatchObject({
      path: "value.ts",
      canUndo: true,
    });
    await writeFile(join(cwd, "value.ts"), "user edit\n");
    const external = await executeTool(
      required(restartedTools.get("workspace_status")),
      {},
      { cwd, runId: "persisted-run" },
    );
    expect(JSON.parse(external.content).changes[0].canUndo).toBe(false);
  });
});

async function workspace(source: string) {
  const cwd = await mkdtemp(join(tmpdir(), "change-workspace-"));
  const home = await mkdtemp(join(tmpdir(), "change-home-"));
  directories.push(cwd, home);
  await writeFile(join(cwd, "value.ts"), source);
  return { cwd, home, changes: new WorkspaceChangeManager(home) };
}

function required(tool: ToolDefinition | undefined): ToolDefinition {
  if (!tool) throw new Error("Missing tool");
  return tool;
}

function revision(source: string): string {
  return revisionOf(source);
}
