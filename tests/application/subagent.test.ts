import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_SYSTEM_PROMPT,
  delegateTaskTool,
  PolicyEngine,
  RunService,
  ToolRegistry,
} from "@fidoo/core";
import {
  createCodingTools,
  LocalWorkspace,
  MemoryArtifactStore,
  MemoryEventStore,
  RunServiceSubagent,
} from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { assistant, call, FakeModel } from "../helpers/fake-model.js";
import { approveAll, rejectAll } from "../helpers/runtime.js";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("read-only subagent", () => {
  it("runs an isolated task with read-only tools and returns its child run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "subagent-"));
    directories.push(cwd);
    await writeFile(join(cwd, "answer.txt"), "read-only finding\n");
    const model = new FakeModel([
      assistant("Reading", [call("read", "read_file", { path: "answer.txt" })]),
      assistant("The file contains a read-only finding"),
    ]);
    const store = new MemoryEventStore();
    const subagent = new RunServiceSubagent({
      model,
      modelName: "child-model",
      store,
      workspace: new LocalWorkspace(),
      artifacts: new MemoryArtifactStore(),
      tools: new ToolRegistry(createCodingTools().filter((tool) => tool.effect === "read")),
      approval: rejectAll,
      policy: new PolicyEngine("read-only"),
      systemPrompt: "Read-only child",
      maxIterations: 5,
    });
    const started: string[] = [];
    const finished: string[] = [];
    const result = await executeTool(
      delegateTaskTool,
      { task: "Inspect answer.txt" },
      {
        cwd,
        runId: "parent-run",
        subagents: subagent,
        onSubagentStarted: (runId) => started.push(runId),
        onSubagentFinished: (subagent) => finished.push(`${subagent.runId}:${subagent.status}`),
      },
    );
    expect(result.success).toBe(true);
    const observation = JSON.parse(result.content);
    expect(observation.status).toBe("completed");
    expect(observation.summary).toContain("read-only finding");
    expect(observation.runId).not.toBe("parent-run");
    expect(model.requests[0]?.tools.some((tool) => tool.name === "delegate_task")).toBe(false);
    expect(model.requests[0]?.tools.some((tool) => tool.name === "bash")).toBe(false);
    const childEvents = await store.load(observation.runId);
    expect(childEvents.at(-1)?.type).toBe("run.completed");
    expect(childEvents[0]).toMatchObject({
      type: "run.started",
      payload: {
        origin: {
          kind: "subagent",
          parentRunId: "parent-run",
          parentCallId: "test-call",
          agentType: "explore",
        },
      },
    });
    expect(started).toEqual([observation.runId]);
    expect(finished).toEqual([`${observation.runId}:completed`]);
    expect(await readFile(join(cwd, "answer.txt"), "utf8")).toBe("read-only finding\n");
  });

  it("records ordered child lifecycle events in the parent run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "subagent-parent-"));
    directories.push(cwd);
    await writeFile(join(cwd, "answer.txt"), "read-only finding\n");
    const model = new FakeModel([
      assistant("Delegating", [call("delegate", "delegate_task", { task: "Inspect answer.txt" })]),
      assistant("Reading", [call("read", "read_file", { path: "answer.txt" })]),
      assistant("Child finding"),
      assistant("Parent completed"),
    ]);
    const store = new MemoryEventStore();
    const workspace = new LocalWorkspace();
    const artifacts = new MemoryArtifactStore();
    const subagent = new RunServiceSubagent({
      model,
      modelName: "child-model",
      store,
      workspace,
      artifacts,
      tools: new ToolRegistry(createCodingTools().filter((tool) => tool.effect === "read")),
      approval: rejectAll,
      policy: new PolicyEngine("read-only"),
      systemPrompt: "Read-only child",
      maxIterations: 5,
    });
    const parent = new RunService({
      model,
      modelName: "parent-model",
      store,
      workspace,
      artifacts,
      tools: new ToolRegistry([delegateTaskTool]),
      subagents: subagent,
      approval: approveAll,
      policy: new PolicyEngine("manual"),
      systemPrompt: BASE_SYSTEM_PROMPT,
      maxIterations: 5,
    });

    const state = await parent.start("Research", cwd, new AbortController().signal);
    expect(state.status).toBe("completed");
    const types = (await store.load(state.runId)).map((event) => event.type);
    expect(types).toContain("subagent.started");
    expect(types).toContain("subagent.finished");
    expect(types.indexOf("subagent.started")).toBeLessThan(types.indexOf("subagent.finished"));
    expect(types.indexOf("subagent.finished")).toBeLessThan(types.lastIndexOf("tool.result"));
  });
});
