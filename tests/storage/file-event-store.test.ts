import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@fidoo/core";
import { FileEventStore } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileEventStore", () => {
  it("persists and lists versioned JSONL events", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-store-"));
    directories.push(root);
    const store = new FileEventStore(root);
    await store.append(
      createEvent(
        { eventId: "e1", runId: "run-1", seq: 1, timestamp: new Date().toISOString() },
        "run.started",
        { task: "Inspect", cwd: root },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "e2", runId: "run-1", seq: 2, timestamp: new Date().toISOString() },
        "run.completed",
        { summary: "Done", verification: "not-required" },
      ),
    );
    expect(await store.load("run-1")).toHaveLength(2);
    expect(await store.list()).toMatchObject([{ runId: "run-1", status: "completed" }]);
  });

  it("does not confuse missing runs with empty sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-store-"));
    directories.push(root);
    const store = new FileEventStore(root);
    await expect(store.load("missing")).rejects.toThrow("Run not found");
  });
});
