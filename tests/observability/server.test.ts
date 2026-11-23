import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvent } from "@fidoo/core";
import { FileEventStore } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { createObservabilityServer } from "../../apps/observability/src/server/server.js";
import { FileObservabilitySource } from "../../apps/observability/src/server/source.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("observability HTTP server", () => {
  it("serves read-only projections, event pages and SSE without credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-inspect-"));
    directories.push(root);
    const store = new FileEventStore(root);
    await store.append(
      createEvent(
        { eventId: "e1", runId: "run-1", seq: 1, timestamp: "2026-01-01T00:00:00.000Z" },
        "run.started",
        { task: "Inspect", cwd: root },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "e2", runId: "run-1", seq: 2, timestamp: "2026-01-01T00:00:01.000Z" },
        "message.assistant",
        {
          message: {
            role: "assistant",
            content: "Done",
            reasoningContent: "private chain",
          },
        },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "e3", runId: "run-1", seq: 3, timestamp: "2026-01-01T00:00:02.000Z" },
        "run.completed",
        { summary: "Done", verification: "not-required" },
      ),
    );
    const baseUrl = await listen(root);

    const runsResponse = await fetch(`${baseUrl}/v1/observability/runs`);
    const runs = (await runsResponse.json()) as { summary: { completed: number; active: number } };
    expect(runsResponse.status).toBe(200);
    expect(runs.summary).toMatchObject({ completed: 1, active: 0 });
    expect(JSON.stringify(runs)).not.toContain("private chain");

    const pageResponse = await fetch(
      `${baseUrl}/v1/observability/runs/run-1/events?afterSeq=1&limit=1`,
    );
    const page = (await pageResponse.json()) as {
      items: Array<{ seq: number }>;
      hasMore: boolean;
    };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.seq).toBe(2);
    expect(page.hasMore).toBe(true);

    const postResponse = await fetch(`${baseUrl}/v1/observability/runs`, { method: "POST" });
    expect(postResponse.status).toBe(405);

    const streamResponse = await fetch(`${baseUrl}/v1/observability/runs/run-1/stream?afterSeq=2`);
    const stream = await streamResponse.text();
    expect(stream).toContain("event: run.completed");
    expect(stream).toContain("id: run-1:3");
    expect(stream).not.toContain("event: message.assistant");
  });

  it("streams events appended by another process and supports afterSeq replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-inspect-live-"));
    directories.push(root);
    const store = new FileEventStore(root);
    await store.append(
      createEvent(
        { eventId: "live-1", runId: "live-run", seq: 1, timestamp: "2026-01-01T00:00:00.000Z" },
        "run.started",
        { task: "Live", cwd: root },
      ),
    );
    const baseUrl = await listen(root);
    const response = await fetch(`${baseUrl}/v1/observability/runs/live-run/stream?afterSeq=1`);
    if (!response.body) throw new Error("Missing SSE body");
    const reader = response.body.getReader();
    await store.append(
      createEvent(
        { eventId: "live-2", runId: "live-run", seq: 2, timestamp: "2026-01-01T00:00:01.000Z" },
        "message.assistant",
        { message: { role: "assistant", content: "Bearer abcdefghijklmnop" } },
      ),
    );
    await store.append(
      createEvent(
        { eventId: "live-3", runId: "live-run", seq: 3, timestamp: "2026-01-01T00:00:02.000Z" },
        "run.completed",
        { summary: "Done", verification: "not-required" },
      ),
    );
    let output = "";
    const decoder = new TextDecoder();
    while (!output.includes("event: run.completed")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
    }
    expect(output).toContain("id: live-run:2");
    expect(output).toContain("id: live-run:3");
    expect(output).toContain("Bearer [redacted]");
    expect(output).not.toContain("abcdefghijklmnop");

    const replay = await fetch(`${baseUrl}/v1/observability/runs/live-run/stream?afterSeq=2`);
    const replayed = await replay.text();
    expect(replayed).toContain("event: run.completed");
    expect(replayed).not.toContain("event: message.assistant");
  });
});

async function listen(root: string): Promise<string> {
  const server = createObservabilityServer({ source: new FileObservabilitySource(root) });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}
