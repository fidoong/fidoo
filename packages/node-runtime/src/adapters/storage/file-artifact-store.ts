import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { Artifact, ArtifactPage, ArtifactStore } from "@fidoo/core";
import { AgentError } from "@fidoo/core";

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async save(runId: string, name: string, content: string): Promise<Artifact> {
    assertRunId(runId);
    const digest = createHash("sha256").update(content).digest("hex");
    const safeName = basename(name).replaceAll(/[^A-Za-z0-9._-]/g, "-");
    const directory = this.directory(runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${digest}-${safeName}`);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    return { id: digest, path, bytes: Buffer.byteLength(content) };
  }

  async read(runId: string, id: string, offset: number, limit: number): Promise<ArtifactPage> {
    assertRunId(runId);
    assertArtifactId(id);
    assertPagination(offset, limit);
    const entries = await readdir(this.directory(runId), { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    });
    const matches = entries.filter(
      (entry) => /^[a-f0-9]{64}-.+/.test(entry.name) && entry.name.startsWith(id),
    );
    const uniqueIds = new Set(matches.map((entry) => entry.name.slice(0, 64)));
    if (uniqueIds.size > 1) {
      throw new AgentError("Artifact id is ambiguous", "storage");
    }
    const match = matches.toSorted((left, right) => left.name.localeCompare(right.name))[0];
    if (!match) {
      throw new AgentError(`Artifact not found: ${id}`, "storage");
    }
    const path = join(this.directory(runId), match.name);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
      throw new AgentError(`Cannot read artifact ${id}: ${errorMessage(error)}`, "storage");
    });
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new AgentError("Artifact is not a regular file", "storage");
      }
      const input = handle.createReadStream({ autoClose: false });
      const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
      const selected: string[] = [];
      let totalLines = 0;
      try {
        for await (const line of lines) {
          if (totalLines >= offset && selected.length < limit) {
            selected.push(line);
          }
          totalLines += 1;
        }
      } finally {
        lines.close();
        input.destroy();
      }
      return {
        id: match.name.slice(0, 64),
        name: match.name.slice(65),
        bytes: stat.size,
        offset,
        limit,
        totalLines,
        content: selected.join("\n"),
        ...(offset + selected.length < totalLines ? { nextOffset: offset + selected.length } : {}),
      };
    } finally {
      await handle.close();
    }
  }

  private directory(runId: string): string {
    return join(this.root, "runs", runId, "artifacts");
  }
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new AgentError("Invalid run id", "storage");
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
