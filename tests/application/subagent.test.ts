import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateTaskTool, PolicyEngine, ToolRegistry } from "@fidoo/core";
import {
  createCodingTools,
  LocalWorkspace,
  MemoryArtifactStore,
  MemoryEventStore,
  RunServiceSubagent,
} from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { assistant, call, FakeModel } from "../helpers/fake-model.js";
import { rejectAll } from "../helpers/runtime.js";
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
    const result = await executeTool(
      delegateTaskTool,
      { task: "Inspect answer.txt" },
      { cwd, runId: "parent-run", subagents: subagent },
    );
    expect(result.success).toBe(true);
    const observation = JSON.parse(result.content);
    expect(observation.status).toBe("completed");
    expect(observation.summary).toContain("read-only finding");
    expect(observation.runId).not.toBe("parent-run");
    expect(model.requests[0]?.tools.some((tool) => tool.name === "delegate_task")).toBe(false);
    expect(model.requests[0]?.tools.some((tool) => tool.name === "bash")).toBe(false);
    expect((await store.load(observation.runId)).at(-1)?.type).toBe("run.completed");
    expect(await readFile(join(cwd, "answer.txt"), "utf8")).toBe("read-only finding\n");
  });
});
