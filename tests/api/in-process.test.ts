import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@fidoo/core";
import { revisionOf } from "@fidoo/node-runtime";
import type { PublicRunEvent } from "@fidoo/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { testApi } from "../helpers/api.js";
import { assistant, call } from "../helpers/fake-model.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "agent-api-"));
  directories.push(cwd);
  return cwd;
}

describe("in-process Agent API", () => {
  it("streams transient reasoning without persisting it in assistant events", async () => {
    const cwd = await workspace();
    const { client } = testApi([
      { role: "assistant", content: "Task done", reasoningContent: "private chain" },
    ]);
    const { runId } = await client.run.start({ task: "Answer", cwd });
    const events = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    expect(events.at(-1)?.type).toBe("run.completed");
    const assistant = events.find((event) => event.type === "message.assistant");
    expect(assistant?.payload).toMatchObject({ message: { content: "Task done" } });
    expect(JSON.stringify(assistant?.payload)).not.toContain("private chain");
    expect(
      events.some(
        (event) =>
          event.type === "message.reasoning.delta" && event.payload.text === "private chain",
      ),
    ).toBe(true);
    const trace = await client.run.trace({ runId });
    expect(trace.some((event) => event.type === "message.reasoning.delta")).toBe(false);
    expect(JSON.stringify(trace)).not.toContain("private chain");
    expect((await client.run.get({ runId })).status).toBe("completed");
  });

  it("round-trips approval and persists the approval boundary", async () => {
    const cwd = await workspace();
    const source = "export const broken = true;\n";
    await writeFile(join(cwd, "value.mjs"), source);
    await writeFile(
      join(cwd, "value.test.mjs"),
      'import assert from "node:assert/strict";\nimport { broken } from "./value.mjs";\nassert.equal(broken, false);\n',
    );
    const { client } = testApi(
      [
        assistant("Editing", [
          call("edit", "edit_file", {
            path: "value.mjs",
            old_string: "true",
            new_string: "false",
            expected_revision: revisionOf(source),
          }),
        ]),
        assistant("Verifying", [
          call("verify", "bash", { command: "node", args: ["--test", "value.test.mjs"] }),
        ]),
        assistant("Verified"),
      ],
      { permission: "ask" },
    );
    const { runId } = await client.run.start({ task: "Fix value", cwd });
    let approvalCount = 0;
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        approvalCount += 1;
        await client.approval.respond({
          runId,
          callId: String(event.payload.callId),
          decision: "approved",
        });
      }
    }
    expect(approvalCount).toBe(2);
    expect((await client.run.get({ runId })).status).toBe("completed");
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toContain("false");
    const trace = await client.run.trace({ runId });
    expect(trace.filter((event) => event.type === "tool.approval_required")).toHaveLength(2);
  });

  it("deduplicates an approval response retried with the same request id", async () => {
    const cwd = await workspace();
    const { api, client } = testApi(
      [
        assistant("Checking", [
          call("check", "bash", { command: process.execPath, args: ["--version"] }),
        ]),
        assistant("Checked"),
      ],
      { permission: "ask" },
    );
    const { runId } = await client.run.start({ task: "Check Node", cwd });
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        const params = {
          runId,
          callId: String(event.payload.callId),
          decision: "approved",
        };
        await api.call("approval.respond", params, "approval-retry");
        await expect(api.call("approval.respond", params, "approval-retry")).resolves.toEqual({
          ok: true,
        });
      }
    }
    expect((await client.run.get({ runId })).status).toBe("completed");
  });

  it("replays afterSeq without duplicate or missing persistent events", async () => {
    const cwd = await workspace();
    const { client } = testApi([assistant("Done")]);
    const { runId } = await client.run.start({ task: "Answer", cwd });
    const first = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    const replayed = await collect(client.run.subscribe({ runId, afterSeq: 2 }));
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((event) => event.seq > 2)).toBe(true);
    const persistent = first.filter((event) => event.type !== "message.assistant.delta");
    const expected = persistent.filter((event) => event.seq > 2).map((event) => event.eventId);
    expect(replayed.map((event) => event.eventId)).toEqual(expected);
    expect(new Set(replayed.map((event) => event.eventId)).size).toBe(replayed.length);
  });

  it("allows only one execution when the same interrupted run is resumed concurrently", async () => {
    const cwd = await workspace();
    const { client, store, model } = testApi([assistant("Resumed once")]);
    const runId = "concurrent-resume";
    await store.append(
      createEvent(
        { eventId: "start", runId, seq: 1, timestamp: new Date().toISOString() },
        "run.started",
        { task: "Original task", cwd },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "message", runId, seq: 2, timestamp: new Date().toISOString() },
        "message.user",
        { message: { role: "user", source: "user", content: "Original task" } },
      ),
    );

    const results = await Promise.allSettled([
      client.run.resume({ runId, task: "First continuation" }),
      client.run.resume({ runId, task: "Competing continuation" }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");

    const events = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    expect(events.at(-1)?.type).toBe("run.completed");
    const trace = await client.run.trace({ runId });
    expect(trace.filter((event) => event.type === "run.resumed")).toHaveLength(1);
    expect(trace.filter((event) => event.type === "message.user")).toHaveLength(2);
    expect(model.requests).toHaveLength(1);
  });

  it("emits structured artifact references and reads the saved output by id", async () => {
    const cwd = await workspace();
    const source = Array.from(
      { length: 400 },
      (_, index) => `${String(index + 1).padStart(4)} ${"x".repeat(80)}`,
    ).join("\n");
    await writeFile(join(cwd, "large.txt"), source);
    const { client } = testApi([
      assistant("Reading", [call("read", "read_file", { path: "large.txt" })]),
      assistant("Done"),
    ]);
    const { runId } = await client.run.start({ task: "Read the large file", cwd });
    const events = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    const resultEvent = events.find((event) => event.type === "tool.result");
    const result = (resultEvent?.payload.result ?? {}) as {
      content?: string;
      artifacts?: Array<{ id: string; name: string; bytes: number }>;
    };
    const artifact = result.artifacts?.[0];
    expect(artifact).toBeDefined();
    expect(result.content).toContain(`artifact ${artifact?.id}`);
    expect(result.content).not.toContain("saved to");
    if (!artifact) throw new Error("Missing artifact reference");
    const page = await client.artifacts.read({
      runId,
      artifactId: artifact.id.slice(0, 12),
      offset: 0,
      limit: 50,
    });
    expect(page).toMatchObject({ id: artifact.id, offset: 0, limit: 50, nextOffset: 50 });
    expect(page.totalLines).toBeGreaterThan(400);
    expect(page.content).toContain("File: large.txt");
    expect(page).not.toHaveProperty("path");
  });

  it("validates missing workspaces before starting a model run", async () => {
    const cwd = await workspace();
    const { client, model, store } = testApi([assistant("Should not run")]);
    const missing = join(cwd, "missing");
    expect(await client.workspace.validate({ cwd: missing })).toMatchObject({ valid: false });
    await expect(client.run.start({ task: "Fix", cwd: missing })).rejects.toThrow(
      "Workspace directory does not exist",
    );
    expect(model.requests).toHaveLength(0);
    expect(await store.list()).toHaveLength(0);
  });
});

async function collect(stream: AsyncIterable<PublicRunEvent>): Promise<PublicRunEvent[]> {
  const events: PublicRunEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
