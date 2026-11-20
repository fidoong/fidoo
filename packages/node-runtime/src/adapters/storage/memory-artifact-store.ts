import { createHash } from "node:crypto";
import type { Artifact, ArtifactStore } from "@fidoo/core";

export class MemoryArtifactStore implements ArtifactStore {
  readonly contents = new Map<string, string>();

  async save(runId: string, name: string, content: string): Promise<Artifact> {
    const id = createHash("sha256").update(content).digest("hex");
    const path = `memory://${runId}/${name}`;
    this.contents.set(path, content);
    return { id, path, bytes: Buffer.byteLength(content) };
  }
}
