import { stat } from "node:fs/promises";
import { join } from "node:path";
import { toPublicRunEvent } from "@fidoo/api";
import { AgentError, type ArtifactPage } from "@fidoo/core";
import { FileArtifactStore, FileEventStore } from "@fidoo/node-runtime";
import {
  paginateEvents,
  projectRun,
  type RunCollection,
  type RunEventPage,
  type RunProjection,
  type RunStatus,
  redactText,
} from "@fidoo/observability";
import type { PublicRunEvent } from "@fidoo/protocol";

interface CachedEvents {
  fingerprint: string;
  events: PublicRunEvent[];
}

export interface RunQuery {
  status?: RunStatus;
  q?: string;
  offset: number;
  limit: number;
}

export interface ObservabilitySource {
  listRuns(query: RunQuery): Promise<RunCollection>;
  getRun(runId: string): Promise<RunProjection>;
  getEvents(runId: string, afterSeq: number, limit: number): Promise<RunEventPage>;
  readArtifact(
    runId: string,
    artifactId: string,
    offset: number,
    limit: number,
  ): Promise<ArtifactPage>;
}

export class FileObservabilitySource implements ObservabilitySource {
  private readonly store: FileEventStore;
  private readonly artifacts: FileArtifactStore;
  private readonly cache = new Map<string, CachedEvents>();

  constructor(private readonly root: string) {
    this.store = new FileEventStore(root);
    this.artifacts = new FileArtifactStore(root);
  }

  async listRuns(query: RunQuery): Promise<RunCollection> {
    const summaries = await this.store.list();
    const runs = await Promise.all(summaries.map((summary) => this.getRun(summary.runId)));
    const search = query.q?.trim().toLowerCase();
    const filtered = runs.filter((run) => {
      if (query.status && run.status !== query.status) return false;
      if (!search) return true;
      return `${run.task}\n${run.cwd}\n${run.runId}`.toLowerCase().includes(search);
    });
    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      offset: query.offset,
      limit: query.limit,
      hasMore: query.offset + query.limit < filtered.length,
    };
  }

  async getRun(runId: string): Promise<RunProjection> {
    return projectRun(runId, await this.events(runId));
  }

  async getEvents(runId: string, afterSeq: number, limit: number): Promise<RunEventPage> {
    return paginateEvents(await this.events(runId), afterSeq, limit);
  }

  async readArtifact(runId: string, artifactId: string, offset: number, limit: number) {
    const page = await this.artifacts.read(runId, artifactId, offset, limit);
    return { ...page, content: redactText(page.content) };
  }

  private async events(runId: string): Promise<PublicRunEvent[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new AgentError("Invalid run id", "storage");
    }
    const path = join(this.root, "runs", runId, "events.jsonl");
    const metadata = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new AgentError(`Run not found: ${runId}`, "storage");
      }
      throw error;
    });
    const fingerprint = `${metadata.mtimeMs}:${metadata.size}`;
    const cached = this.cache.get(runId);
    if (cached?.fingerprint === fingerprint) {
      return cached.events;
    }
    const events = (await this.store.load(runId)).map(toPublicRunEvent);
    this.cache.set(runId, { fingerprint, events });
    return events;
  }
}
