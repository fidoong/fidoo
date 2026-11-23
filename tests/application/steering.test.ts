import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelEvent,
  type ModelPort,
  type ModelRequest,
  PolicyEngine,
  RunService,
  ToolRegistry,
  updatePlanTool,
} from "@fidoo/core";
import { LocalWorkspace, MemoryArtifactStore, MemoryEventStore } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { approveAll } from "../helpers/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Run steering", () => {
  it("persists active-run guidance and forces another model turn before completion", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-steering-"));
    directories.push(cwd);
    const model = new ControlledModel();
    const store = new MemoryEventStore();
    const service = new RunService({
      model,
      modelName: "controlled",
      store,
      workspace: new LocalWorkspace(),
      artifacts: new MemoryArtifactStore(),
      tools: new ToolRegistry([]),
      approval: approveAll,
      policy: new PolicyEngine("auto"),
      systemPrompt: "system",
      maxIterations: 5,
    });
    const running = service.start(
      "Initial task",
      cwd,
      new AbortController().signal,
      "steering-run",
    );
    await model.firstRequest.promise;
    await service.steer("steering-run", "Keep the public API stable");
    model.release.promiseResolve();
    const state = await running;

    expect(state.status).toBe("completed");
    expect(state.finalSummary).toBe("Steered response");
    expect(model.requests).toHaveLength(2);
    expect(
      model.requests[1]?.messages.some(
        (message) => message.role === "user" && message.content === "Keep the public API stable",
      ),
    ).toBe(true);
    const events = await store.load("steering-run");
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(events.some((event) => event.type === "run.steered")).toBe(true);
    expect(events.at(-1)?.type).toBe("run.completed");
    await expect(service.steer("steering-run", "Too late")).rejects.toThrow("Run is not active");
  });

  it("does not insert steering between assistant tool calls and tool results", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-steering-tools-"));
    directories.push(cwd);
    const model = new ToolModel();
    const toolStarted = deferred();
    const finishTool = deferred();
    const work = {
      ...updatePlanTool,
      name: "work",
      description: "Controlled work",
      execute: async () => {
        toolStarted.promiseResolve();
        await finishTool.promise;
        return { summary: "Worked", content: "tool result" };
      },
    };
    const service = new RunService({
      model,
      modelName: "controlled-tools",
      store: new MemoryEventStore(),
      workspace: new LocalWorkspace(),
      artifacts: new MemoryArtifactStore(),
      tools: new ToolRegistry([work]),
      approval: approveAll,
      policy: new PolicyEngine("auto"),
      systemPrompt: "system",
      maxIterations: 5,
    });
    const running = service.start(
      "Use the tool",
      cwd,
      new AbortController().signal,
      "steering-tools",
    );
    await toolStarted.promise;
    await service.steer("steering-tools", "Preserve compatibility");
    finishTool.promiseResolve();
    await running;
    const messages = model.requests[1]?.messages ?? [];
    const callIndex = messages.findIndex(
      (message) =>
        message.role === "assistant" && message.toolCalls?.some((call) => call.id === "work"),
    );
    const resultIndex = messages.findIndex(
      (message) => message.role === "tool" && message.toolCallId === "work",
    );
    const steeringIndex = messages.findIndex(
      (message) => message.role === "user" && message.content === "Preserve compatibility",
    );
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(callIndex);
    expect(steeringIndex).toBeGreaterThan(resultIndex);
  });
});

class ControlledModel implements ModelPort {
  readonly requests: ModelRequest[] = [];
  readonly firstRequest = deferred();
  readonly release = deferred();

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      this.firstRequest.promiseResolve();
      await this.release.promise;
      yield { type: "text.delta", text: "Initial response" };
      yield {
        type: "message.completed",
        message: { role: "assistant", content: "Initial response" },
      };
      return;
    }
    yield { type: "text.delta", text: "Steered response" };
    yield {
      type: "message.completed",
      message: { role: "assistant", content: "Steered response" },
    };
  }
}

class ToolModel implements ModelPort {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: "message.completed",
        message: {
          role: "assistant",
          content: "Working",
          toolCalls: [
            {
              id: "work",
              name: "work",
              arguments: '{"steps":[{"id":"work","title":"Work","status":"in_progress"}]}',
            },
          ],
        },
      };
      return;
    }
    yield {
      type: "message.completed",
      message: { role: "assistant", content: "Finished" },
    };
  }
}

function deferred() {
  let promiseResolve: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    promiseResolve = resolve;
  });
  return { promise, promiseResolve };
}
