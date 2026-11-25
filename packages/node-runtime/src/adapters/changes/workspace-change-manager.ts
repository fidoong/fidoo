import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AgentError, type WorkspaceChangeSummary, type WorkspaceFileChange } from "@fidoo/core";
import { structuredPatch } from "diff";
import { withFileLock } from "../storage/file-lock.js";
import { atomicWrite, prepareWritePath } from "../system/files.js";
import {
  assertInsideWorkspace,
  relativePath,
  resolveExistingPath,
  resolveWorkspacePath,
  revisionOf,
} from "../system/workspace.js";

interface ChangeRecord {
  path: string;
  hasBefore: boolean;
  beforeRevision?: string;
  lastRevision?: string;
}

export class WorkspaceChangeManager {
  private readonly runs = new Map<string, Map<string, ChangeRecord>>();
  private readonly snapshots = new Map<string, Map<string, string>>();
  private readonly loaded = new Set<string>();

  constructor(private readonly root?: string) {}

  async capture(cwd: string, runId: string, paths: string[]): Promise<void> {
    await this.load(runId);
    for (const input of paths) {
      const path = await normalizePath(cwd, input);
      const records = this.run(runId);
      if (records.has(path)) continue;
      const current = await this.readCurrent(cwd, path);
      const record: ChangeRecord = {
        path,
        hasBefore: current !== undefined,
        ...(current !== undefined ? { beforeRevision: revisionOf(current) } : {}),
        ...(current !== undefined ? { lastRevision: revisionOf(current) } : {}),
      };
      if (current !== undefined) {
        const snapshots = this.snapshots.get(runId) ?? new Map<string, string>();
        snapshots.set(path, current);
        this.snapshots.set(runId, snapshots);
      }
      await this.writeRecord(runId, record, current);
      records.set(path, record);
    }
  }

  async afterMutation(cwd: string, runId: string, paths: string[]): Promise<void> {
    await this.load(runId);
    for (const input of paths) {
      const path = await normalizePath(cwd, input);
      const record = this.run(runId).get(path);
      if (!record) continue;
      const current = await this.readCurrent(cwd, path);
      if (current === undefined) delete record.lastRevision;
      else record.lastRevision = revisionOf(current);
      await this.writeRecord(runId, record, undefined);
    }
  }

  async list(cwd: string, runId: string): Promise<WorkspaceChangeSummary> {
    await this.load(runId);
    const changes: WorkspaceFileChange[] = [];
    for (const record of this.run(runId).values()) {
      const before = record.hasBefore ? await this.readSnapshot(runId, record) : "";
      const current = await this.readCurrent(cwd, record.path);
      if (record.hasBefore && current !== undefined && current === before) continue;
      if (!record.hasBefore && current === undefined) continue;
      const after = current ?? "";
      const patch = structuredPatch(record.path, record.path, before, after, "before", "current", {
        context: 3,
      });
      const addedLines = patch.hunks.reduce(
        (total, hunk) => total + hunk.lines.filter((line) => line.startsWith("+")).length,
        0,
      );
      const deletedLines = patch.hunks.reduce(
        (total, hunk) => total + hunk.lines.filter((line) => line.startsWith("-")).length,
        0,
      );
      const currentRevision = current === undefined ? undefined : revisionOf(current);
      changes.push({
        path: record.path,
        status: !record.hasBefore ? "added" : current === undefined ? "deleted" : "modified",
        ...(record.beforeRevision ? { beforeRevision: record.beforeRevision } : {}),
        ...(currentRevision ? { currentRevision } : {}),
        addedLines,
        deletedLines,
        diff: formatPatch(record.path, patch.hunks),
        canUndo: currentRevision === record.lastRevision,
      });
    }
    changes.sort((left, right) => left.path.localeCompare(right.path));
    return {
      files: changes.length,
      addedLines: changes.reduce((total, change) => total + change.addedLines, 0),
      deletedLines: changes.reduce((total, change) => total + change.deletedLines, 0),
      changes,
    };
  }

  async undoFile(cwd: string, runId: string, path: string): Promise<void> {
    await this.load(runId);
    const normalized = await normalizePath(cwd, path);
    const record = this.run(runId).get(normalized);
    if (!record) throw new AgentError(`No recorded change for ${normalized}`, "configuration");
    await this.assertUndoCurrent(cwd, record);
    await this.restore(cwd, runId, record);
    this.run(runId).delete(normalized);
    this.snapshots.get(runId)?.delete(normalized);
    await this.removeRecord(runId, normalized);
  }

  async undoRun(cwd: string, runId: string): Promise<string[]> {
    await this.load(runId);
    const records = [...this.run(runId).values()];
    for (const record of records) await this.assertUndoCurrent(cwd, record);
    for (const record of records) {
      await this.restore(cwd, runId, record);
      this.run(runId).delete(record.path);
      this.snapshots.get(runId)?.delete(record.path);
      await this.removeRecord(runId, record.path);
    }
    return records.map((record) => record.path);
  }

  private async assertUndoCurrent(cwd: string, record: ChangeRecord): Promise<void> {
    const current = await this.readCurrent(cwd, record.path);
    const revision = current === undefined ? undefined : revisionOf(current);
    if (revision !== record.lastRevision) {
      throw new AgentError(
        `Cannot undo ${record.path}: file changed outside the recorded Agent mutation`,
        "tool",
      );
    }
  }

  private async restore(cwd: string, runId: string, record: ChangeRecord): Promise<void> {
    if (record.hasBefore) {
      const before = await this.readSnapshot(runId, record);
      const target = await prepareWritePath(cwd, record.path);
      await atomicWrite(target, before);
    } else {
      const target = await resolveExistingPath(cwd, record.path).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      if (target) await rm(target);
    }
  }

  private async readCurrent(cwd: string, path: string): Promise<string | undefined> {
    const target = resolveWorkspacePath(cwd, path);
    try {
      return await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readSnapshot(runId: string, record: ChangeRecord): Promise<string> {
    const memory = this.snapshots.get(runId)?.get(record.path);
    if (memory !== undefined) return memory;
    const directory = this.directory(runId, record.path);
    if (!directory)
      throw new AgentError("In-memory changes cannot be restored after restart", "storage");
    try {
      return await readFile(join(directory, "before.txt"), "utf8");
    } catch (error) {
      throw new AgentError(`Cannot read snapshot for ${record.path}: ${String(error)}`, "storage");
    }
  }

  private async writeRecord(
    runId: string,
    record: ChangeRecord,
    before: string | undefined,
  ): Promise<void> {
    const directory = this.directory(runId, record.path);
    if (!directory) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await withFileLock(join(directory, "change.lock"), async () => {
      if (before !== undefined) await atomicWrite(join(directory, "before.txt"), before);
      await atomicWrite(join(directory, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
    });
  }

  private async load(runId: string): Promise<void> {
    assertId(runId);
    if (this.loaded.has(runId)) return;
    const records = new Map<string, ChangeRecord>();
    this.runs.set(runId, records);
    const root = this.runDirectory(runId);
    if (root) {
      const entries = await readdir(root, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const record = JSON.parse(
          await readFile(join(root, entry.name, "record.json"), "utf8"),
        ) as ChangeRecord;
        records.set(record.path, record);
      }
    }
    this.loaded.add(runId);
  }

  private run(runId: string): Map<string, ChangeRecord> {
    return this.runs.get(runId) ?? new Map();
  }

  private async removeRecord(runId: string, path: string): Promise<void> {
    const directory = this.directory(runId, path);
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  private directory(runId: string, path: string): string | undefined {
    return this.root ? join(this.runDirectory(runId) as string, hash(path)) : undefined;
  }

  private runDirectory(runId: string): string | undefined {
    assertId(runId);
    return this.root ? join(this.root, "changes", runId) : undefined;
  }
}

function formatPatch(path: string, hunks: ReturnType<typeof structuredPatch>["hunks"]): string {
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    lines.push(...hunk.lines);
  }
  return lines.join("\n");
}

async function normalizePath(cwd: string, input: string): Promise<string> {
  const root = await realpath(cwd);
  let target = resolve(root, input);
  try {
    target = await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  assertInsideWorkspace(root, target);
  return relativePath(root, target);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertId(value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AgentError("Invalid run id", "configuration");
}
