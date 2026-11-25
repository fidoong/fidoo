import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDirectoryTool, readManyFilesTool } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("read convenience tools", () => {
  it("reads multiple files concurrently with independent revisions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "read-many-"));
    directories.push(cwd);
    await writeFile(join(cwd, "a.txt"), "alpha\n");
    await writeFile(join(cwd, "b.txt"), "beta\n");
    const result = await executeTool(readManyFilesTool, { paths: ["a.txt", "b.txt"] }, { cwd });
    expect(result.content).toContain("File: a.txt");
    expect(result.content).toContain("File: b.txt");
    expect(result.content.match(/Revision: /g)).toHaveLength(2);
  });

  it("lists only immediate entries and marks directories", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "list-directory-"));
    directories.push(cwd);
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src/nested.txt"), "nested\n");
    await writeFile(join(cwd, "root.txt"), "root\n");
    const result = await executeTool(listDirectoryTool, {}, { cwd });
    expect(result.content).toContain("src/");
    expect(result.content).toContain("root.txt");
    expect(result.content).not.toContain("nested.txt");
  });
});
