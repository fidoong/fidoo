import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectAgentServer } from "@fidoo/client/stdio";
import { AgentController, TuiApp } from "@fidoo/tui";
import { execa } from "execa";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("stdio and TUI end to end", () => {
  it("fixes and verifies a real workspace through keyboard approval and a child server", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-stdio-tui-"));
    cleanups.push(() => rm(cwd, { recursive: true, force: true }));
    const brokenSource = "export function add(left, right) {\n  return left - right;\n}\n";
    await writeFile(join(cwd, "math.mjs"), brokenSource);
    await writeFile(
      join(cwd, "math.test.mjs"),
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "./math.mjs";\ntest("add", () => assert.equal(add(2, 3), 5));\n',
    );
    const provider = await mockProvider(brokenSource);
    cleanups.push(provider.close);

    const serverEntry = fileURLToPath(
      new URL("../../apps/agent-server/src/index.ts", import.meta.url),
    );
    const connection = connectAgentServer({
      args: [
        "--import",
        "tsx",
        serverEntry,
        "--stdio",
        "--cwd",
        cwd,
        "--provider",
        "openai",
        "--model",
        "test-model",
        "--base-url",
        provider.baseURL,
      ],
      env: {
        ...process.env,
        FIDOO_API_KEY: "test-key",
        FIDOO_HOME: join(cwd, "agent-home"),
      },
    });
    cleanups.push(connection.close);
    let protocolOutput = "";
    connection.process.stdout?.on("data", (chunk) => {
      protocolOutput += String(chunk);
    });

    const controller = new AgentController(connection.client, cwd);
    const view = render(
      <TuiApp
        controller={controller}
        options={{ cwd, provider: "openai", model: "test-model" }}
        onExit={() => undefined}
      />,
    );
    cleanups.push(() => view.unmount());
    view.stdin.write("Fix the failing add test");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Fix the failing add test"));
    view.stdin.write("\r");

    await vi.waitFor(
      () => {
        expect(view.lastFrame()).toContain("Approval required");
        expect(view.lastFrame()).toContain("edit_file · math.mjs");
      },
      { timeout: 10_000 },
    );
    view.stdin.write("y");
    await vi.waitFor(
      () => {
        expect(view.lastFrame(), view.stderr.lastFrame()).toContain("Approval required");
        expect(view.lastFrame()).toContain("bash · node --test math.test.mjs");
      },
      { timeout: 10_000 },
    );
    view.stdin.write("y");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("completed"), {
      timeout: 15_000,
    });

    expect(view.lastFrame()).toContain("Fixed and verified add()");
    expect(view.lastFrame()).toContain("+return left + right;");
    expect(await readFile(join(cwd, "math.mjs"), "utf8")).toContain("left + right");
    const verification = await execa("node", ["--test", "math.test.mjs"], {
      cwd,
      reject: false,
    });
    expect(verification.exitCode).toBe(0);
    expect(provider.requests).toBe(4);
    for (const line of protocolOutput.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  }, 30_000);

  it("restarts a crashed sidecar and reconciles a pending approval", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-recovery-"));
    cleanups.push(() => rm(cwd, { recursive: true, force: true }));
    const provider = await recoveryProvider();
    cleanups.push(provider.close);
    const serverEntry = fileURLToPath(
      new URL("../../apps/agent-server/src/index.ts", import.meta.url),
    );
    const connection = connectAgentServer({
      args: [
        "--import",
        "tsx",
        serverEntry,
        "--stdio",
        "--cwd",
        cwd,
        "--provider",
        "openai",
        "--model",
        "test-model",
        "--base-url",
        provider.baseURL,
      ],
      env: {
        ...process.env,
        FIDOO_API_KEY: "test-key",
        FIDOO_HOME: join(cwd, "agent-home"),
      },
    });
    cleanups.push(connection.close);
    const controller = new AgentController(connection.client, cwd);
    const view = render(
      <TuiApp
        controller={controller}
        options={{ cwd, provider: "openai", model: "test-model" }}
        onExit={() => undefined}
      />,
    );
    cleanups.push(() => view.unmount());
    view.stdin.write("Recover the interrupted run");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Recover the interrupted run"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("Approval required"), {
      timeout: 10_000,
    });

    const firstPid = connection.process.pid;
    const runId = controller.getSnapshot().runId;
    const observed = (async () => {
      let starts = 0;
      for await (const event of connection.client.run.subscribe({
        runId: runId ?? "",
        afterSeq: 0,
      })) {
        if (event.type === "run.started") starts += 1;
      }
      return starts;
    })();
    connection.process.kill("SIGKILL");
    await vi.waitFor(
      () => {
        expect(view.lastFrame()).toContain("completed");
        expect(view.lastFrame()).toContain("Recovered after restart");
      },
      { timeout: 15_000 },
    );
    expect(connection.process.pid).not.toBe(firstPid);
    expect(controller.getSnapshot().runId).toBe(runId);
    expect(controller.getSnapshot().pendingApproval).toBeUndefined();
    expect(provider.requests).toBe(2);
    const trace = await connection.client.run.trace({ runId: runId ?? "" });
    expect(new Set(trace.map((event) => event.eventId)).size).toBe(trace.length);
    expect(trace.filter((event) => event.type === "tool.result")).toHaveLength(1);
    await expect(observed).resolves.toBe(1);
  }, 30_000);
});

async function recoveryProvider(): Promise<{
  baseURL: string;
  requests: number;
  close(): Promise<void>;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (requests === 1) {
        response.write(
          toolCall("wait", "bash", { command: process.execPath, args: ["--version"] }, "Waiting"),
        );
      } else {
        response.write(textDelta("Recovered after restart"));
      }
      response.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    get requests() {
      return requests;
    },
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function mockProvider(source: string): Promise<{
  baseURL: string;
  requests: number;
  close(): Promise<void>;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const step = requests;
      if (step === 1) {
        response.write(toolCall("read", "read_file", { path: "math.mjs" }, "Inspecting"));
      } else if (step === 2) {
        response.write(
          toolCall(
            "edit",
            "edit_file",
            {
              path: "math.mjs",
              old_string: "return left - right;",
              new_string: "return left + right;",
              expected_revision: createHash("sha256").update(source).digest("hex"),
            },
            "Editing",
          ),
        );
      } else if (step === 3) {
        response.write(
          toolCall(
            "verify",
            "bash",
            { command: "node", args: ["--test", "math.test.mjs"] },
            "Verifying",
          ),
        );
      } else {
        response.write(textDelta("Fixed and verified add()."));
      }
      response.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    get requests() {
      return requests;
    },
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

function toolCall(id: string, name: string, input: unknown, text: string): string {
  return `${textDelta(text)}${sse({
    tool_calls: [
      {
        index: 0,
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(input) },
      },
    ],
  })}`;
}

function textDelta(content: string): string {
  return sse({ content });
}

function sse(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\n\n`;
}
