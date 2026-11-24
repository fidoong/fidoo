import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProjectInstructions } from "@fidoo/core";
import { loadRequiredChecks } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("project verification config", () => {
  it("loads required checks and exposes them to the model", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "project-checks-"));
    directories.push(cwd);
    await writeFile(
      join(cwd, ".fidoo.json"),
      JSON.stringify({
        verification: {
          requiredChecks: [
            {
              id: "unit",
              command: "node",
              args: ["--test", "unit.test.mjs"],
              timeoutMs: 30_000,
              paths: ["src/**"],
            },
          ],
        },
      }),
    );
    const checks = await loadRequiredChecks(cwd);
    expect(checks).toEqual([
      {
        id: "unit",
        command: "node",
        args: ["--test", "unit.test.mjs"],
        timeoutMs: 30_000,
        paths: ["src/**"],
      },
    ]);
    expect(withProjectInstructions(undefined, checks)).toContain(
      'unit: "node" "--test" "unit.test.mjs"',
    );
  });

  it("fails fast for duplicate check ids", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "project-checks-"));
    directories.push(cwd);
    await writeFile(
      join(cwd, ".fidoo.json"),
      JSON.stringify({
        verification: {
          requiredChecks: [
            { id: "same", command: "node", args: ["--test"] },
            { id: "same", command: "pnpm", args: ["lint"] },
          ],
        },
      }),
    );
    await expect(loadRequiredChecks(cwd)).rejects.toThrow("duplicate required check id same");
  });
});
