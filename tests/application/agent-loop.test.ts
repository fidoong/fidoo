import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@fidoo/core";
import { revisionOf } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { assistant, call } from "../helpers/fake-model.js";
import { rejectAll, testRuntime } from "../helpers/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function sourceFile() {
  const cwd = await mkdtemp(join(tmpdir(), "agent-loop-"));
  directories.push(cwd);
  const source = "export const broken = true;\n";
  await writeFile(join(cwd, "value.mjs"), source);
  return { cwd, source };
}

describe("AgentLoop", () => {
  it("rejects premature completion and continues until verification passes", async () => {
    const { cwd, source } = await sourceFile();
    const { service, store } = testRuntime([
      assistant("Editing", [
        call("edit", "edit_file", {
          path: "value.mjs",
          old_string: "true",
          new_string: "false",
          expected_revision: revisionOf(source),
        }),
      ]),
      assistant("Done without checking"),
      assistant("Verifying", [
        call("verify", "bash", {
          command: "node",
          args: ["--test", "value.test.mjs"],
        }),
      ]),
      assistant("Fixed and verified"),
    ]);
    await writeFile(
      join(cwd, "value.test.mjs"),
      'import assert from "node:assert/strict";\nimport { broken } from "./value.mjs";\nassert.equal(broken, false);\n',
    );
    const state = await service.start("Fix value", cwd, new AbortController().signal);
    const events = await store.load(state.runId);
    expect(state.status).toBe("completed");
    expect(events.some((event) => event.type === "verification.requested")).toBe(true);
    expect(events.findIndex((event) => event.type === "verification.requested")).toBeLessThan(
      events.findIndex(
        (event) => event.type === "tool.result" && event.payload.result.verification,
      ),
    );
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toContain("false");
  });

  it("does not write when approval is rejected", async () => {
    const { cwd, source } = await sourceFile();
    const { service } = testRuntime(
      [
        assistant("Editing", [
          call("edit", "edit_file", {
            path: "value.mjs",
            old_string: "true",
            new_string: "false",
            expected_revision: revisionOf(source),
          }),
        ]),
        assistant("I could not edit because approval was rejected"),
      ],
      { permission: "ask", approval: rejectAll },
    );
    const state = await service.start("Fix value", cwd, new AbortController().signal);
    expect(state.status).toBe("completed");
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toBe(source);
    expect(state.changedFiles.size).toBe(0);
  });

  it("records failed commands as errors and ends explicit blockers as blocked", async () => {
    const { cwd } = await sourceFile();
    const { service, store } = testRuntime([
      assistant("Checking", [
        call("failing-command", "bash", {
          command: "node",
          args: ["-e", "process.exit(1)"],
        }),
      ]),
      assistant("Cannot continue", [
        call("blocked", "report_blocked", { reason: "External dependency is unavailable" }),
      ]),
    ]);
    const state = await service.start("Run a blocked task", cwd, new AbortController().signal);
    expect(state.status).toBe("blocked");
    expect(state.error).toBe("External dependency is unavailable");
    const events = await store.load(state.runId);
    expect(events.find((event) => event.type === "tool.result")).toMatchObject({
      payload: { result: { status: "error" } },
    });
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
    expect(await store.list()).toMatchObject([{ status: "blocked" }]);
  });

  it("persists provider-neutral model usage", async () => {
    const { cwd } = await sourceFile();
    const { service, store } = testRuntime([assistant("Done")], {
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    const state = await service.start("Measure usage", cwd, new AbortController().signal);
    const events = await store.load(state.runId);
    expect(events.find((event) => event.type === "model.usage")).toMatchObject({
      payload: { inputTokens: 12, outputTokens: 7 },
    });
  });

  it("marks interrupted calls for reconciliation instead of replaying them", async () => {
    const { cwd, source } = await sourceFile();
    const { service, store } = testRuntime([assistant("Recovered without replay")]);
    const runId = "interrupted-run";
    await store.append(
      createEvent(
        { eventId: "e1", runId, seq: 1, timestamp: new Date().toISOString() },
        "run.started",
        { task: "Write", cwd },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "e2", runId, seq: 2, timestamp: new Date().toISOString() },
        "tool.proposed",
        { call: call("write", "write_file", { path: "new.txt", content: "must not replay" }) },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "e3", runId, seq: 3, timestamp: new Date().toISOString() },
        "tool.started",
        { callId: "write" },
      ),
    );
    const state = await service.resume(runId, undefined, new AbortController().signal);
    expect(state.status).toBe("completed");
    await expect(readFile(join(cwd, "new.txt"), "utf8")).rejects.toThrow();
    expect(source).toContain("true");
    expect(
      (await store.load(runId)).some(
        (event) =>
          event.type === "tool.result" && event.payload.result.content.includes("not replayed"),
      ),
    ).toBe(true);
  });
});
