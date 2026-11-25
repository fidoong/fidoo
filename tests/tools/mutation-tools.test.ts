import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("atomic mutation tools", () => {
  it("applies a multi-file patch and rejects a whole batch on revision conflict", async () => {
    const { cwd, tools } = await workspace();
    const result = await executeTool(
      required(tools.get("apply_patch")),
      {
        files: [
          {
            path: "a.ts",
            expected_revision: revisionOf("export const a = true;\n"),
            edits: [{ old_string: "true", new_string: "false" }],
          },
          {
            path: "b.ts",
            expected_revision: revisionOf("export const b = 1;\n"),
            edits: [{ old_string: "1", new_string: "2" }],
          },
        ],
      },
      { cwd, runId: "run-1" },
    );
    expect(result.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toContain("false");
    expect(await readFile(join(cwd, "b.ts"), "utf8")).toContain("2");

    await expect(
      executeTool(
        required(tools.get("apply_patch")),
        {
          files: [
            {
              path: "a.ts",
              expected_revision: revisionOf("export const a = false;\n"),
              edits: [{ old_string: "false", new_string: "true" }],
            },
            {
              path: "b.ts",
              expected_revision: revisionOf("wrong"),
              edits: [{ old_string: "2", new_string: "3" }],
            },
          ],
        },
        { cwd, runId: "run-1" },
      ),
    ).rejects.toThrow("revision changed");
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toContain("false");
    expect(await readFile(join(cwd, "b.ts"), "utf8")).toContain("2");
  });

  it("moves and deletes files with revision protection", async () => {
    const { cwd, tools } = await workspace();
    await executeTool(
      required(tools.get("move_file")),
      {
        source_path: "a.ts",
        target_path: "nested/moved.ts",
        expected_revision: revisionOf("export const a = true;\n"),
      },
      { cwd, runId: "run-1" },
    );
    expect(await readFile(join(cwd, "nested/moved.ts"), "utf8")).toContain("true");
    await expect(readFile(join(cwd, "a.ts"), "utf8")).rejects.toThrow();
    await executeTool(
      required(tools.get("delete_file")),
      {
        path: "b.ts",
        expected_revision: revisionOf("export const b = 1;\n"),
      },
      { cwd, runId: "run-1" },
    );
    await expect(readFile(join(cwd, "b.ts"), "utf8")).rejects.toThrow();
    const status = await executeTool(
      required(tools.get("workspace_status")),
      {},
      { cwd, runId: "run-1" },
    );
    expect(JSON.parse(status.content).changes).toMatchObject([
      { path: "a.ts", status: "deleted" },
      { path: "b.ts", status: "deleted" },
      { path: "nested/moved.ts", status: "added" },
    ]);
  });

  it("undoes a whole run after prechecking every file", async () => {
    const { cwd, tools } = await workspace();
    await executeTool(
      required(tools.get("apply_patch")),
      {
        files: [
          {
            path: "a.ts",
            expected_revision: revisionOf("export const a = true;\n"),
            edits: [{ old_string: "true", new_string: "false" }],
          },
          {
            path: "b.ts",
            expected_revision: revisionOf("export const b = 1;\n"),
            edits: [{ old_string: "1", new_string: "2" }],
          },
        ],
      },
      { cwd, runId: "run-1" },
    );
    await executeTool(required(tools.get("undo_run")), {}, { cwd, runId: "run-1" });
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("export const a = true;\n");
    expect(await readFile(join(cwd, "b.ts"), "utf8")).toBe("export const b = 1;\n");
    const status = await executeTool(
      required(tools.get("workspace_status")),
      {},
      { cwd, runId: "run-1" },
    );
    expect(JSON.parse(status.content).files).toBe(0);
  });

  it("refuses undo after an external edit", async () => {
    const { cwd, tools } = await workspace();
    await executeTool(
      required(tools.get("delete_file")),
      {
        path: "a.ts",
        expected_revision: revisionOf("export const a = true;\n"),
      },
      { cwd, runId: "run-1" },
    );
    await writeFile(join(cwd, "a.ts"), "user recreated it\n");
    await expect(
      executeTool(required(tools.get("undo_run")), {}, { cwd, runId: "run-1" }),
    ).rejects.toThrow("changed outside");
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("user recreated it\n");
  });
});

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "mutation-tools-"));
  const home = await mkdtemp(join(tmpdir(), "mutation-home-"));
  directories.push(cwd, home);
  await writeFile(join(cwd, "a.ts"), "export const a = true;\n");
  await writeFile(join(cwd, "b.ts"), "export const b = 1;\n");
  const changes = new WorkspaceChangeManager(home);
  return { cwd, tools: new ToolRegistry(createCodingTools(undefined, [], changes)) };
}

function required(tool: ToolDefinition | undefined): ToolDefinition {
  if (!tool) throw new Error("Missing tool");
  return tool;
}
