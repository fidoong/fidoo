import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoMapTool } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("repo_map", () => {
  it("maps symbols, imports, entry points and tests without exposing excluded files", async () => {
    const cwd = await fixture();
    const result = await executeTool(repoMapTool, { path: ".", maxFiles: 50 }, { cwd });
    expect(result.summary).toContain("Mapped");
    expect(result.content).toContain("src/index.ts [TypeScript]");
    expect(result.content).toContain("main");
    expect(result.content).toContain("./util.js");
    expect(result.content).toContain("src/service.py [Python]");
    expect(result.content).toContain("Service");
    expect(result.content).toContain("tests/index.test.ts");
    expect(result.content).not.toContain("ignored-secret");
    expect(result.content).not.toContain("dependency-secret");
    expect(result.content).not.toContain("credential-secret");
  });

  it("bounds the number of inspected files", async () => {
    const cwd = await fixture();
    const result = await executeTool(repoMapTool, { path: ".", maxFiles: 10 }, { cwd });
    expect(result.content).toContain("showing 10 prioritized files");
  });

  it("rejects indexing outside the workspace", async () => {
    const cwd = await fixture();
    await expect(executeTool(repoMapTool, { path: ".." }, { cwd })).rejects.toThrow(
      "Path escapes workspace",
    );
  });
});

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "fidoo-repo-map-"));
  directories.push(cwd);
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await mkdir(join(cwd, "ignored"), { recursive: true });
  await mkdir(join(cwd, "node_modules", "dependency"), { recursive: true });
  await writeFile(join(cwd, ".gitignore"), "ignored/\n");
  await writeFile(join(cwd, "package.json"), '{"name":"fixture"}');
  await writeFile(
    join(cwd, "src", "index.ts"),
    'import { helper } from "./util.js";\nexport function main() { return helper(); }\n',
  );
  await writeFile(join(cwd, "src", "util.ts"), "export const helper = () => 42;\n");
  await writeFile(
    join(cwd, "src", "service.py"),
    "import os\nclass Service:\n    def run(self):\n        return os.name\n",
  );
  await writeFile(join(cwd, "tests", "index.test.ts"), "export const testCase = true;\n");
  for (let index = 0; index < 12; index += 1) {
    await writeFile(
      join(cwd, "src", `feature-${index}.ts`),
      `export const feature${index} = ${index};\n`,
    );
  }
  await writeFile(join(cwd, "ignored", "hidden.ts"), "// ignored-secret\n");
  await writeFile(join(cwd, "node_modules", "dependency", "index.js"), "// dependency-secret\n");
  await writeFile(join(cwd, ".env"), "credential-secret\n");
  return cwd;
}
