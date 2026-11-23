import { createHash } from "node:crypto";
import type { Artifact, ArtifactPage, ArtifactStore } from "@fidoo/core";
import { AgentError } from "@fidoo/core";

export class MemoryArtifactStore implements ArtifactStore {
  readonly contents = new Map<string, string>();
  private readonly records = new Map<
    string,
    { artifact: Artifact; name: string; content: string }
  >();

  async save(runId: string, name: string, content: string): Promise<Artifact> {
    const id = createHash("sha256").update(content).digest("hex");
    const path = `memory://${runId}/${name}`;
    const artifact = { id, path, bytes: Buffer.byteLength(content) };
    this.contents.set(path, content);
    this.records.set(`${runId}:${id}`, { artifact, name, content });
    return artifact;
  }

  async read(runId: string, id: string, offset: number, limit: number): Promise<ArtifactPage> {
    assertArtifactId(id);
    assertPagination(offset, limit);
    const matches = [...this.records.entries()].filter(
      ([key, record]) => key.startsWith(`${runId}:`) && record.artifact.id.startsWith(id),
    );
    const uniqueIds = new Set(matches.map(([, record]) => record.artifact.id));
    if (uniqueIds.size > 1) {
      throw new AgentError("Artifact id is ambiguous", "storage");
    }
    const record = matches[0]?.[1];
    if (!record) {
      throw new AgentError(`Artifact not found: ${id}`, "storage");
    }
    const lines = splitLines(record.content);
    const selected = lines.slice(offset, offset + limit);
    return {
      id: record.artifact.id,
      name: record.name,
      bytes: record.artifact.bytes,
      offset,
      limit,
      totalLines: lines.length,
      content: selected.join("\n"),
      ...(offset + selected.length < lines.length ? { nextOffset: offset + selected.length } : {}),
    };
  }
}

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }
  const lines = content.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(content)) {
    lines.pop();
  }
  return lines;
}

function assertArtifactId(id: string): void {
  if (!/^[a-f0-9]{8,64}$/.test(id)) {
    throw new AgentError("Invalid artifact id", "storage");
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
    throw new AgentError("Invalid artifact pagination", "storage");
  }
}
