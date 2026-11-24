import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundTaskManager } from "@fidoo/node-runtime";
import type { BackgroundTaskEvent } from "@fidoo/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testApi } from "../helpers/api.js";
import { assistant, call } from "../helpers/fake-model.js";

const directories: string[] = [];
const managers: BackgroundTaskManager[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    for (const task of await manager.list()) {
      if (task.status === "running") await manager.stop(task.taskId);
    }
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("background tasks", () => {
  it("persists output and stops a surviving process after manager restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-tasks-"));
    directories.push(root);
    const manager = new BackgroundTaskManager(root);
    managers.push(manager);
    const task = await manager.start({
      runId: "run-background",
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      cwd: root,
    });
    await vi.waitFor(async () => {
      expect((await manager.readOutput(task.taskId)).content).toContain("ready");
    });
    expect((await manager.list("run-background"))[0]?.status).toBe("running");

    const restored = new BackgroundTaskManager(root);
    managers.push(restored);
    expect((await restored.get(task.taskId)).status).toBe("running");
    const stopped = await restored.stop(task.taskId);
    expect(stopped.status).toBe("stopped");
    await vi.waitFor(() => expect(processAlive(task.pid)).toBe(false));
    expect((await new BackgroundTaskManager(root).get(task.taskId)).status).toBe("stopped");
  });

  it("notifies natural process exit and retains the recorded exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-tasks-"));
    directories.push(root);
    const manager = new BackgroundTaskManager(root);
    managers.push(manager);
    const events: BackgroundTaskEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const task = await manager.start({
      runId: "run-background",
      command: process.execPath,
      args: ["-e", "process.stdout.write('finished output'); process.exit(0)"],
      cwd: root,
    });
    await vi.waitFor(async () => {
      expect((await manager.get(task.taskId)).status).toBe("exited");
    });
    expect(events.some((event) => event.type === "task.finished")).toBe(true);
    expect((await manager.get(task.taskId)).exitCode).toBe(0);
    expect((await manager.readOutput(task.taskId)).content).toContain("finished output");
  });

  it("keeps a task available across model turns and after run completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-tasks-"));
    directories.push(root);
    const { client, tasks } = testApi(
      [
        assistant("Starting", [
          call("start", "bash", {
            command: process.execPath,
            args: ["-e", "process.stdout.write('server ready'); setInterval(() => {}, 1000)"],
            background: true,
          }),
        ]),
        assistant("Checking", [call("list", "task_list", {})]),
        assistant("Background server is running"),
      ],
      { permission: "ask" },
    );
    managers.push(tasks);
    const notifications = client.tasks.subscribe();
    const iterator = notifications[Symbol.asyncIterator]();
    const started = iterator.next();
    const { runId } = await client.run.start({ task: "Start a server", cwd: root });
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "tool.approval_required") {
        await client.approval.respond({
          runId,
          callId: String(event.payload.callId),
          decision: "approved",
        });
      }
    }
    expect((await client.run.get({ runId })).status).toBe("completed");
    const running = await client.tasks.list({ runId });
    expect(running).toHaveLength(1);
    expect(running[0]?.status).toBe("running");
    const taskId = running[0]?.taskId ?? "";
    await vi.waitFor(async () => {
      expect((await client.tasks.output({ taskId })).content).toContain("server ready");
    });

    expect((await started).done).toBe(false);
    await client.tasks.stop({ taskId });
    const finished = await iterator.next();
    expect(finished.done).toBe(false);
    expect(finished.value).toMatchObject({
      type: "task.finished",
      task: { taskId, status: "stopped" },
    });
    await iterator.return?.();
  });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
