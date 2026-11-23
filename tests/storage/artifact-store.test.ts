import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactStore } from "@fidoo/core";
import { FileArtifactStore, MemoryArtifactStore } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

for (const kind of ["memory", "file"] as const) {
  describe(`${kind} artifact store`, () => {
    it("reads a stable id with bounded forward pagination", async () => {
      const store = await createStore(kind);
      const content = Array.from({ length: 10 }, (_, index) => `line ${index + 1} · 中文`).join(
        "\n",
      );
      const artifact = await store.save("run-1", "command output.txt", content);
      const first = await store.read("run-1", artifact.id.slice(0, 12), 0, 3);
      expect(first).toMatchObject({
        id: artifact.id,
        offset: 0,
        limit: 3,
        totalLines: 10,
        nextOffset: 3,
        content: "line 1 · 中文\nline 2 · 中文\nline 3 · 中文",
      });
      const second = await store.read("run-1", artifact.id, first.nextOffset ?? 3, 3);
      expect(second.content).toBe("line 4 · 中文\nline 5 · 中文\nline 6 · 中文");
      expect(second.nextOffset).toBe(6);
      const last = await store.read("run-1", artifact.id, 9, 3);
      expect(last.content).toBe("line 10 · 中文");
      expect(last.nextOffset).toBeUndefined();
    });

    it("rejects paths, invalid ids and invalid pagination", async () => {
      const store = await createStore(kind);
      await expect(store.read("run-1", "../../secret", 0, 10)).rejects.toThrow(
        "Invalid artifact id",
      );
      await expect(store.read("run-1", "abcdef12", -1, 10)).rejects.toThrow(
        "Invalid artifact pagination",
      );
      await expect(store.read("run-1", "abcdef12", 0, 0)).rejects.toThrow(
        "Invalid artifact pagination",
      );
      await expect(store.read("run-1", "abcdef12", 0, 10)).rejects.toThrow("Artifact not found");
    });
  });
}

it("file artifact store refuses a symlink at the artifact path", async () => {
  const root = await temporaryDirectory();
  const store = new FileArtifactStore(root);
  const artifact = await store.save("run-1", "output.txt", "original");
  const outside = join(root, "outside.txt");
  await writeFile(outside, "secret", "utf8");
  await unlink(artifact.path);
  await symlink(outside, artifact.path);
  await expect(store.read("run-1", artifact.id, 0, 10)).rejects.toThrow("Cannot read artifact");
});

async function createStore(kind: "memory" | "file"): Promise<ArtifactStore> {
  return kind === "memory"
    ? new MemoryArtifactStore()
    : new FileArtifactStore(await temporaryDirectory());
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "fidoo-artifact-store-"));
  directories.push(path);
  return path;
}
