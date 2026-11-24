import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { AgentError } from "@fidoo/core";

const LOCK_TIMEOUT_MS = 10_000;
const INVALID_LOCK_STALE_MS = 30_000;

export async function withFileLock<Type>(
  path: string,
  operation: () => Promise<Type>,
): Promise<Type> {
  const lock = await acquire(path);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

interface Lock {
  release(): Promise<void>;
}

async function acquire(path: string): Promise<Lock> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner = `${process.pid}:${randomUUID()}`;
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(owner, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(path).catch(() => undefined);
        throw error;
      }
      return {
        async release() {
          await handle.close();
          await unlink(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (await removeAbandonedLock(path)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new AgentError(`Timed out waiting for event store lock: ${path}`, "storage", true);
      }
      await sleep(10 + Math.floor(Math.random() * 20));
    }
  }
}

async function removeAbandonedLock(path: string): Promise<boolean> {
  try {
    const owner = await readFile(path, "utf8");
    const match = /^(\d+):[0-9a-f-]+$/.exec(owner);
    if (match) {
      return processAlive(Number(match[1])) ? false : removeLock(path);
    }
    const metadata = await stat(path);
    return Date.now() - metadata.mtimeMs >= INVALID_LOCK_STALE_MS ? removeLock(path) : false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function removeLock(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
