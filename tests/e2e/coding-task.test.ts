import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revisionOf } from "@fidoo/node-runtime";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { assistant, call } from "../helpers/fake-model.js";
import { testRuntime } from "../helpers/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("offline coding task", () => {
  it("fixes a real failing test and verifies the delivered workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-e2e-"));
    directories.push(cwd);
    const brokenSource = "export function add(left, right) {\n  return left - right;\n}\n";
    await writeFile(join(cwd, "math.mjs"), brokenSource);
    await writeFile(
      join(cwd, "math.test.mjs"),
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "./math.mjs";\ntest("add", () => assert.equal(add(2, 3), 5));\n',
    );
    const before = await execa("node", ["--test", "math.test.mjs"], { cwd, reject: false });
    expect(before.exitCode).not.toBe(0);

    const { service, store } = testRuntime([
      assistant("I will inspect the implementation", [
        call("read", "read_file", { path: "math.mjs" }),
      ]),
      assistant("I found the incorrect operator", [
        call("edit", "edit_file", {
          path: "math.mjs",
          old_string: "return left - right;",
          new_string: "return left + right;",
          expected_revision: revisionOf(brokenSource),
        }),
      ]),
      assistant("Now I will run the test", [
        call("test", "bash", { command: "node", args: ["--test", "math.test.mjs"] }),
      ]),
      assistant("Fixed add() and verified it with node --test math.test.mjs."),
    ]);
    const state = await service.start(
      "Fix the failing add test",
      cwd,
      new AbortController().signal,
    );
    expect(state.status).toBe("completed");
    expect(state.finalSummary).toContain("verified");
    expect(await readFile(join(cwd, "math.mjs"), "utf8")).toContain("left + right");
    const after = await execa("node", ["--test", "math.test.mjs"], { cwd, reject: false });
    expect(after.exitCode).toBe(0);
    const events = await store.load(state.runId);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      payload: { verification: "passed" },
    });
  });
});
