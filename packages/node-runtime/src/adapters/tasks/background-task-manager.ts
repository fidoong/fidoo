import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AgentError } from "@fidoo/core";
import type { BackgroundTask, BackgroundTaskEvent, TaskOutputPage } from "@fidoo/protocol";
import { backgroundTaskSchema } from "@fidoo/protocol";
import { execa } from "execa";
import { CommandExecutor } from "../execution/command-executor.js";
import { terminateProcessTree } from "../execution/process.js";
import type { PreparedCommand } from "../execution/types.js";
import { withFileLock } from "../storage/file-lock.js";

interface StartTaskInput {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  workspace?: string;
  prepared?: PreparedCommand;
}

export class BackgroundTaskManager {
  private readonly tasks = new Map<string, BackgroundTask>();
  private readonly listeners = new Set<(event: BackgroundTaskEvent) => void>();
  private readonly output = new Map<string, string>();
  private readonly stopping = new Set<string>();
  private readonly active = new Set<string>();
  private ready: Promise<void> | undefined;

  constructor(
    private readonly root?: string,
    private readonly executor = new CommandExecutor(),
  ) {}

  onEvent(listener: (event: BackgroundTaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(input: StartTaskInput): Promise<BackgroundTask> {
    await this.load();
    const taskId = randomUUID();
    const directory = this.directory(taskId);
    if (directory) await mkdir(directory, { recursive: true, mode: 0o700 });
    const stream = directory
      ? createWriteStream(join(directory, "output.log"), { flags: "a", mode: 0o600 })
      : undefined;
    const prepared = input.prepared ?? (await this.executor.prepare(input));
    const subprocess = execa(prepared.command, prepared.args, {
      cwd: input.cwd,
      env: prepared.env,
      extendEnv: false,
      shell: false,
      reject: false,
      detached: process.platform !== "win32",
      buffer: false,
      preferLocal: true,
    });
    if (!subprocess.pid) {
      stream?.destroy();
      throw new AgentError(`Cannot start background command: ${input.command}`, "tool");
    }
    const task: BackgroundTask = {
      taskId,
      runId: input.runId,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      pid: subprocess.pid,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    const forward = (chunk: unknown) => {
      const text = String(chunk);
      if (stream) {
        stream.write(text);
      } else {
        const combined = (this.output.get(taskId) ?? "") + text;
        this.output.set(
          taskId,
          combined.length > 1_000_000 ? combined.slice(-1_000_000) : combined,
        );
      }
    };
    subprocess.stdout?.on("data", forward);
    subprocess.stderr?.on("data", forward);
    await this.persist(task);
    this.emit({ type: "task.started", task });
    this.active.add(taskId);
    void this.waitForExit(taskId, subprocess, stream)
      .catch(() => undefined)
      .finally(() => this.active.delete(taskId));
    return task;
  }

  async list(runId?: string): Promise<BackgroundTask[]> {
    await this.load();
    await this.refreshExitedTasks();
    return [...this.tasks.values()]
      .filter((task) => !runId || task.runId === runId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async get(taskId: string): Promise<BackgroundTask> {
    await this.load();
    await this.refreshExitedTasks();
    const task = this.tasks.get(taskId);
    if (!task) throw new AgentError(`Background task not found: ${taskId}`, "configuration");
    return task;
  }

  async stop(taskId: string): Promise<BackgroundTask> {
    const task = await this.get(taskId);
    if (task.status !== "running") return task;
    this.stopping.add(taskId);
    terminateProcessTree(task.pid, "SIGTERM");
    const timer = setTimeout(() => terminateProcessTree(task.pid, "SIGKILL"), 5000);
    timer.unref();
    const stopped: BackgroundTask = {
      ...task,
      status: "stopped",
      endedAt: new Date().toISOString(),
    };
    const saved = await this.persist(stopped);
    this.tasks.set(taskId, saved);
    this.emit({ type: "task.finished", task: saved });
    return saved;
  }

  async readOutput(taskId: string, offset = 0, limit = 200): Promise<TaskOutputPage> {
    await this.get(taskId);
    assertPagination(offset, limit);
    const path = this.outputPath(taskId);
    const content = path ? undefined : (this.output.get(taskId) ?? "");
    const selected: string[] = [];
    let totalLines = 0;
    if (content !== undefined) {
      const lines = content.split(/\r\n|\r|\n/);
      if (/(?:\r\n|\r|\n)$/.test(content)) lines.pop();
      totalLines = lines.length;
      selected.push(...lines.slice(offset, offset + limit));
    } else if (path) {
      const input = createReadStream(path, { encoding: "utf8" });
      const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
      try {
        for await (const line of lines) {
          if (totalLines >= offset && selected.length < limit) selected.push(line);
          totalLines += 1;
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
    return {
      taskId,
      offset,
      limit,
      totalLines,
      content: selected.join("\n"),
      ...(offset + selected.length < totalLines ? { nextOffset: offset + selected.length } : {}),
    };
  }

  private async waitForExit(
    taskId: string,
    subprocess: PromiseLike<{ exitCode?: number }>,
    stream: WriteStream | undefined,
  ): Promise<void> {
    let result: { exitCode?: number } | undefined;
    let failure: unknown;
    try {
      result = await subprocess;
    } catch (error) {
      failure = error;
    }
    if (stream) {
      await new Promise<void>((resolve) => stream.end(resolve));
    }
    const current = this.tasks.get(taskId);
    if (current?.status !== "running") return;
    const finished: BackgroundTask = {
      ...current,
      status: failure ? "failed" : "exited",
      endedAt: new Date().toISOString(),
      ...(result?.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(failure ? { error: failure instanceof Error ? failure.message : String(failure) } : {}),
    };
    const saved = await this.persist(finished);
    this.tasks.set(taskId, saved);
    this.emit({ type: "task.finished", task: saved });
  }

  private async refreshExitedTasks(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.status !== "running" || processAlive(task.pid)) continue;
      if (this.active.has(task.taskId) || this.stopping.has(task.taskId)) continue;
      const finished: BackgroundTask = {
        ...task,
        status: "exited",
        endedAt: new Date().toISOString(),
      };
      const saved = await this.persist(finished);
      this.tasks.set(task.taskId, saved);
      this.emit({ type: "task.finished", task: saved });
    }
  }

  private async load(): Promise<void> {
    if (!this.ready) this.ready = this.readPersisted();
    return this.ready;
  }

  private async readPersisted(): Promise<void> {
    if (!this.root) return;
    const root = join(this.root, "tasks");
    const entries = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const source = await readFile(join(root, entry.name, "task.json"), "utf8");
        const task = backgroundTaskSchema.parse(JSON.parse(source));
        this.tasks.set(task.taskId, task);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new AgentError(
          `Invalid background task record ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
          "storage",
        );
      }
    }
  }

  private async persist(task: BackgroundTask): Promise<BackgroundTask> {
    const directory = this.directory(task.taskId);
    if (!directory) return task;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return withFileLock(join(directory, "task.lock"), async () => {
      const path = join(directory, "task.json");
      const existing = await this.readRecord(path);
      const effective =
        existing?.status === "stopped" && task.status !== "stopped" ? existing : task;
      if (existing === effective) return effective;
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      try {
        await writeFile(
          temporary,
          `${JSON.stringify(backgroundTaskSchema.parse(effective), null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return effective;
    });
  }

  private async readRecord(path: string): Promise<BackgroundTask | undefined> {
    try {
      return backgroundTaskSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private directory(taskId: string): string | undefined {
    assertTaskId(taskId);
    return this.root ? join(this.root, "tasks", taskId) : undefined;
  }

  private outputPath(taskId: string): string | undefined {
    const directory = this.directory(taskId);
    return directory ? join(directory, "output.log") : undefined;
  }

  private emit(event: BackgroundTaskEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function assertTaskId(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AgentError("Invalid background task id", "configuration");
  }
}

function assertPagination(offset: number, limit: number): void {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  ) {
    throw new AgentError("Invalid task output pagination", "configuration");
  }
}
