import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import { assertInsideWorkspace, resolveWorkspacePath } from "./workspace.js";

export async function atomicWrite(path: string, content: string): Promise<void> {
  const mode = await existingMode(path);
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function prepareWritePath(cwd: string, path: string): Promise<string> {
  const target = resolveWorkspacePath(cwd, path);
  const root = await realpath(cwd);
  let ancestor = dirname(target);
  while (true) {
    try {
      const realAncestor = await realpath(ancestor);
      assertInsideWorkspace(root, realAncestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new AgentError(`Cannot resolve write path: ${path}`, "tool");
      }
      ancestor = parent;
    }
  }
  await mkdir(dirname(target), { recursive: true });
  const realParent = await realpath(dirname(target));
  assertInsideWorkspace(root, realParent);
  return target;
}

async function existingMode(path: string): Promise<number> {
  try {
    return (await stat(path)).mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0o600;
    }
    throw error;
  }
}
