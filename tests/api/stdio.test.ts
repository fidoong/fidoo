import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { StdioServer } from "@fidoo/agent-server";
import { createAgentClient } from "@fidoo/client";
import { StdioTransport } from "@fidoo/client/stdio";
import type { PublicRunEvent } from "@fidoo/protocol";
import { JSON_RPC_VERSION, PROTOCOL_VERSION } from "@fidoo/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { testApi } from "../helpers/api.js";
import { assistant, call } from "../helpers/fake-model.js";

const cleanups: Array<() => Promise<void>> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("stdio Agent API", () => {
  it("matches in-process semantics for fast runs and multiple subscribers", async () => {
    const cwd = await workspace();
    const { client } = stdioApi([
      { role: "assistant", content: "Done over stdio", reasoningContent: "stdio reasoning" },
    ]);
    const { runId } = await client.run.start({ task: "Answer", cwd });
    const [first, second] = await Promise.all([
      collect(client.run.subscribe({ runId, afterSeq: 0 })),
      collect(client.run.subscribe({ runId, afterSeq: 0 })),
    ]);
    expect(first.at(-1)?.type).toBe("run.completed");
    expect(second.map((event) => event.eventId)).toEqual(first.map((event) => event.eventId));
    expect(first.find((event) => event.type === "message.assistant")?.payload).toMatchObject({
      message: { content: "Done over stdio" },
    });
    expect(first.some((event) => event.type === "message.reasoning.delta")).toBe(true);
    expect((await client.run.get({ runId })).status).toBe("completed");
  });

  it("round-trips approval over concurrent requests and notifications", async () => {
    const cwd = await workspace();
    const { client } = stdioApi(
      [
        assistant("Checking", [
          call("check", "bash", { command: process.execPath, args: ["--version"] }),
        ]),
        assistant("Checked"),
      ],
      { permission: "ask" },
    );
    const { runId } = await client.run.start({ task: "Check Node", cwd });
    let approvals = 0;
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        approvals += 1;
        await client.approval.respond({
          runId,
          callId: String(event.payload.callId),
          decision: "approved",
        });
      }
    }
    expect(approvals).toBe(1);
    expect((await client.run.get({ runId })).status).toBe("completed");
  });

  it("closes a subscription without cancelling the run", async () => {
    const cwd = await workspace();
    const { client } = stdioApi(
      [
        assistant("Checking", [
          call("check", "bash", { command: process.execPath, args: ["--version"] }),
        ]),
        assistant("Checked"),
      ],
      { permission: "ask" },
    );
    const { runId } = await client.run.start({ task: "Check Node", cwd });
    let callId = "";
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        callId = String(event.payload.callId);
        break;
      }
    }
    expect(callId).not.toBe("");
    expect((await client.run.get({ runId })).status).toBe("running");
    await client.approval.respond({ runId, callId, decision: "approved" });
    const remaining = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    expect(remaining.at(-1)?.type).toBe("run.completed");
  });

  it("cancels a run through the same connection", async () => {
    const cwd = await workspace();
    const { client } = stdioApi(
      [
        assistant("Waiting", [
          call("wait", "bash", { command: process.execPath, args: ["--version"] }),
        ]),
      ],
      { permission: "ask" },
    );
    const { runId } = await client.run.start({ task: "Wait for approval", cwd });
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        break;
      }
    }
    expect((await client.run.cancel({ runId })).status).toBe("cancelled");
    expect((await client.run.get({ runId })).status).toBe("cancelled");
  });

  it("propagates blocked status", async () => {
    const cwd = await workspace();
    const { client } = stdioApi([
      assistant("Cannot continue", [
        call("blocked", "report_blocked", { reason: "Credentials are required" }),
      ]),
    ]);
    const { runId } = await client.run.start({ task: "Deploy", cwd });
    const events = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    expect(events.at(-1)?.type).toBe("run.blocked");
    expect((await client.run.get({ runId })).status).toBe("blocked");
  });

  it("replays afterSeq without duplicate or missing persistent events", async () => {
    const cwd = await workspace();
    const { client } = stdioApi([assistant("Done")]);
    const { runId } = await client.run.start({ task: "Answer", cwd });
    const first = await collect(client.run.subscribe({ runId, afterSeq: 0 }));
    const replayed = await collect(client.run.subscribe({ runId, afterSeq: 2 }));
    const expected = first
      .filter((event) => event.type !== "message.assistant.delta" && event.seq > 2)
      .map((event) => event.eventId);
    expect(replayed.map((event) => event.eventId)).toEqual(expected);
    expect(new Set(replayed.map((event) => event.eventId)).size).toBe(replayed.length);
  });

  it("reads artifact pages through the same stdio connection", async () => {
    const { client, artifacts } = stdioApi([assistant("Unused")]);
    const saved = await artifacts.save("run-artifact", "output.txt", "one\ntwo\nthree");
    const page = await client.artifacts.read({
      runId: "run-artifact",
      artifactId: saved.id.slice(0, 8),
      offset: 1,
      limit: 1,
    });
    expect(page).toMatchObject({
      id: saved.id,
      name: "output.txt",
      content: "two",
      offset: 1,
      totalLines: 3,
      nextOffset: 2,
    });
  });

  it("handles fragmented NDJSON and reports protocol errors on stdout only", async () => {
    const cwd = await workspace();
    const { input, output, close } = rawServer();
    const lines = createInterface({ input: output });
    const iterator = lines[Symbol.asyncIterator]();
    cleanups.push(async () => {
      lines.close();
      await close();
    });

    const valid = JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      requestId: "fragmented",
      method: "workspace.validate",
      params: { cwd },
    });
    input.write(valid.slice(0, 17));
    input.write(valid.slice(17));
    input.write("\n");
    const response = await nextLine(iterator);
    expect(response).toMatchObject({ requestId: "fragmented", result: { valid: true } });

    input.write("{not-json}\n");
    expect(await nextLine(iterator)).toMatchObject({
      requestId: null,
      error: { code: -32700 },
    });

    input.write(
      `${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, protocolVersion: "v0", requestId: "version", method: "run.list", params: {} })}\n`,
    );
    expect(await nextLine(iterator)).toMatchObject({
      requestId: "version",
      error: { code: -32600, data: { protocolVersion: "v1" } },
    });

    input.write(
      `${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, protocolVersion: PROTOCOL_VERSION, requestId: "method", method: "missing.method", params: {} })}\n`,
    );
    expect(await nextLine(iterator)).toMatchObject({
      requestId: "method",
      error: { code: -32601 },
    });

    input.write(
      `${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, protocolVersion: PROTOCOL_VERSION, requestId: "params", method: "run.start", params: {} })}\n`,
    );
    expect(await nextLine(iterator)).toMatchObject({
      requestId: "params",
      error: { code: -32602 },
    });
  });
});

function stdioApi(
  responses: Parameters<typeof testApi>[0],
  options: Parameters<typeof testApi>[1] = {},
) {
  const runtime = testApi(responses, options);
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new StdioServer(runtime.api, input, output);
  const transport = new StdioTransport(output, input);
  server.listen();
  const fixture = {
    client: createAgentClient(transport),
    async close() {
      transport.close();
      await server.close();
    },
  };
  cleanups.push(fixture.close);
  return { ...runtime, ...fixture };
}

function rawServer() {
  const runtime = testApi([assistant("Unused")]);
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new StdioServer(runtime.api, input, output);
  server.listen();
  return {
    ...runtime,
    input,
    output,
    async close() {
      input.end();
      await server.close();
      output.end();
    },
  };
}

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "agent-stdio-"));
  directories.push(cwd);
  return cwd;
}

async function collect(stream: AsyncIterable<PublicRunEvent>): Promise<PublicRunEvent[]> {
  const events: PublicRunEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function nextLine(iterator: AsyncIterator<string>): Promise<Record<string, unknown>> {
  const next = await iterator.next();
  expect(next.done).toBe(false);
  return JSON.parse(next.value) as Record<string, unknown>;
}
