import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFileTool, readFileTool, revisionOf, writeFileTool } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "agent-tools-"));
  directories.push(path);
  return path;
}

describe("file tools", () => {
  it("preserves text and applies a revision-protected exact edit", async () => {
    const cwd = await workspace();
    const original = "const message = “你好”;\nconst broken = true;\n";
    await writeFile(join(cwd, "a.ts"), original);
    const read = await executeTool(readFileTool, { path: "a.ts" }, { cwd });
    expect(read.content).toContain(`Revision: ${revisionOf(original)}`);
    await executeTool(
      editFileTool,
      {
        path: "a.ts",
        old_string: "const broken = true;",
        new_string: "const broken = false;",
        expected_revision: revisionOf(original),
      },
      { cwd },
    );
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe(
      "const message = “你好”;\nconst broken = false;\n",
    );
  });

  it("rejects stale writes and ambiguous edits", async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, "a.ts"), "same\nsame\n");
    await expect(
      executeTool(
        writeFileTool,
        { path: "a.ts", content: "replacement", expected_revision: "0".repeat(64) },
        { cwd },
      ),
    ).rejects.toThrow("revision changed");
    await expect(
      executeTool(
        editFileTool,
        {
          path: "a.ts",
          old_string: "same",
          new_string: "different",
          expected_revision: revisionOf("same\nsame\n"),
        },
        { cwd },
      ),
    ).rejects.toThrow("occurs 2 times");
  });

  it("requires a revision when overwriting and denies sensitive paths", async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, "a.ts"), "old");
    await expect(
      executeTool(writeFileTool, { path: "a.ts", content: "new" }, { cwd }),
    ).rejects.toThrow("provide expected_revision");
    await expect(
      executeTool(writeFileTool, { path: ".env", content: "secret" }, { cwd }),
    ).rejects.toThrow("Sensitive file access is denied");
    await expect(
      executeTool(writeFileTool, { path: "../outside", content: "bad" }, { cwd }),
    ).rejects.toThrow("escapes workspace");
  });
});
