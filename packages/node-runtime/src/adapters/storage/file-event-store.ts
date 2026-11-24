import type { Dirent } from "node:fs";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, EventStore, RunSummary } from "@fidoo/core";
import { AgentError, EVENT_SCHEMA_VERSION, EVENT_TYPES } from "@fidoo/core";
import { z } from "zod";
import { withFileLock } from "./file-lock.js";

const eventEnvelopeSchema = z.object({
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1),
  runId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  seq: z.number().int().positive(),
  timestamp: z.string().datetime(),
  type: z.enum(EVENT_TYPES),
  payload: z.unknown(),
});

export class FileEventStore implements EventStore {
  private readonly appendChains = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  append(event: AgentEvent): Promise<void> {
    const previous = this.appendChains.get(event.runId) ?? Promise.resolve();
    const result = previous.then(() => this.appendNow(event));
    const tail = result.catch(() => undefined);
    this.appendChains.set(event.runId, tail);
    void tail.then(() => {
      if (this.appendChains.get(event.runId) === tail) {
        this.appendChains.delete(event.runId);
      }
    });
    return result;
  }

  private async appendNow(event: AgentEvent): Promise<void> {
    const directory = this.runDirectory(event.runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await withFileLock(this.lockPath(event.runId), async () => {
      const events = await this.readEvents(event.runId, true);
      if (event.seq !== events.length + 1) {
        throw new AgentError(
          `Invalid event sequence for ${event.runId}: expected ${events.length + 1}, received ${event.seq}`,
          "storage",
        );
      }
      if (events.some((existing) => existing.eventId === event.eventId)) {
        throw new AgentError(`Duplicate event id: ${event.eventId}`, "storage");
      }
      const handle = await open(this.eventPath(event.runId), "a", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  async load(runId: string): Promise<AgentEvent[]> {
    const pending = this.appendChains.get(runId);
    if (pending) await pending;
    const directory = this.runDirectory(runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return withFileLock(this.lockPath(runId), () => this.readEvents(runId, false));
  }

  private async readEvents(runId: string, allowMissing: boolean): Promise<AgentEvent[]> {
    let source: string;
    try {
      source = await readFile(this.eventPath(runId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (allowMissing) return [];
        throw new AgentError(`Run not found: ${runId}`, "storage");
      }
      throw error;
    }

    const events: AgentEvent[] = [];
    const lines = source.split("\n").filter((line) => line.length > 0);
    for (const [index, line] of lines.entries()) {
      try {
        const event = eventEnvelopeSchema.parse(JSON.parse(line));
        events.push(event as unknown as AgentEvent);
      } catch (error) {
        throw new AgentError(
          `Corrupt event at ${runId}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          "storage",
        );
      }
    }
    return events;
  }

  async list(): Promise<RunSummary[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(join(this.root, "runs"), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const summaries: RunSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const events = await this.load(entry.name);
      const started = events.find((event) => event.type === "run.started");
      if (!started) {
        continue;
      }
      const terminal = events.findLast(
        (event) =>
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.blocked" ||
          event.type === "run.cancelled" ||
          event.type === "run.resumed",
      );
      const last = events.at(-1);
      summaries.push({
        runId: started.runId,
        task: started.payload.task,
        cwd: started.payload.cwd,
        status:
          terminal?.type === "run.completed"
            ? "completed"
            : terminal?.type === "run.failed"
              ? "failed"
              : terminal?.type === "run.blocked"
                ? "blocked"
                : terminal?.type === "run.cancelled"
                  ? "cancelled"
                  : "running",
        createdAt: started.timestamp,
        updatedAt: last?.timestamp ?? started.timestamp,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private runDirectory(runId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new AgentError("Invalid run id", "storage");
    }
    return join(this.root, "runs", runId);
  }

  private eventPath(runId: string): string {
    return join(this.runDirectory(runId), "events.jsonl");
  }

  private lockPath(runId: string): string {
    return join(this.runDirectory(runId), "events.lock");
  }
}
