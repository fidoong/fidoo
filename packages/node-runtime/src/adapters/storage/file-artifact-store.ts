import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Artifact, ArtifactStore } from "@fidoo/core";

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async save(runId: string, name: string, content: string): Promise<Artifact> {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error("Invalid run id");
    }
    const digest = createHash("sha256").update(content).digest("hex");
    const safeName = basename(name).replaceAll(/[^A-Za-z0-9._-]/g, "-");
    const directory = join(this.root, "runs", runId, "artifacts");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${digest}-${safeName}`);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    return { id: digest, path, bytes: Buffer.byteLength(content) };
  }
}
