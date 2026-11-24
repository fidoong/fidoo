import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@fidoo/core";
import { FileEventStore } from "@fidoo/node-runtime";
import { execa } from "execa";
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

  it("rejects duplicate ids and sequence gaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-store-"));
    directories.push(root);
    const store = new FileEventStore(root);
    await store.append(storeEvent(root, "e1", 1));
    await expect(store.append(storeEvent(root, "e1", 2))).rejects.toThrow("Duplicate event id");
    await expect(store.append(storeEvent(root, "e3", 3))).rejects.toThrow("Invalid event sequence");
    expect(await store.load("run-1")).toHaveLength(1);
  });

  it("allows only one competing process to claim the next sequence", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-store-"));
    directories.push(root);
    const storeModule = new URL(
      "../../packages/node-runtime/src/adapters/storage/file-event-store.ts",
      import.meta.url,
    ).href;
    const coreModule = new URL("../../packages/core/src/domain/events.ts", import.meta.url).href;
    const source = `
      import { FileEventStore } from ${JSON.stringify(storeModule)};
      import { createEvent } from ${JSON.stringify(coreModule)};
      const store = new FileEventStore(${JSON.stringify(root)});
      try {
        await store.append(createEvent({
          eventId: "competing-event",
          runId: "run-1",
          seq: 1,
          timestamp: ${JSON.stringify(new Date().toISOString())}
        }, "run.started", { task: "Competing writers", cwd: ${JSON.stringify(root)} }));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
      }
    `;
    const append = () =>
      execa(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
        cwd: process.cwd(),
        reject: false,
        timeout: 10_000,
      });
    const results = await Promise.all([append(), append()]);
    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 2]);
    expect(await new FileEventStore(root).load("run-1")).toHaveLength(1);
    expect(await readdir(join(root, "runs", "run-1"))).not.toContain("events.lock");
  }, 15_000);

  it("recovers an append lock left by a dead process", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-store-"));
    directories.push(root);
    const directory = join(root, "runs", "run-1");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "events.lock"),
      "999999:00000000-0000-0000-0000-000000000000",
      "utf8",
    );
    const store = new FileEventStore(root);
    await store.append(storeEvent(root, "recovered", 1));
    expect(await store.load("run-1")).toHaveLength(1);
  });
});

function storeEvent(root: string, eventId: string, seq: number) {
  return createEvent(
    { eventId, runId: "run-1", seq, timestamp: new Date().toISOString() },
    "run.started",
    { task: "Inspect", cwd: root },
  );
}
