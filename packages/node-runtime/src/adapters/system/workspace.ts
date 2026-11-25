import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { AgentError } from "@fidoo/core";
import ignore from "ignore";

const sensitiveNames = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
]);

export function resolveWorkspacePath(cwd: string, path: string): string {
  const root = resolve(cwd);
  const target = resolve(root, path);
  assertInsideWorkspace(root, target);
  return target;
}

export async function resolveExistingPath(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const target = await realpath(resolveWorkspacePath(cwd, path));
  assertInsideWorkspace(root, target);
  return target;
}

export function assertInsideWorkspace(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new AgentError(`Path escapes workspace: ${target}`, "tool");
  }
}

export function assertNotSensitive(path: string): void {
  const name = basename(path);
  if (
    sensitiveNames.has(name) ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key")
  ) {
    throw new AgentError(`Sensitive file access is denied: ${name}`, "tool");
  }
}

export function relativePath(cwd: string, path: string): string {
  try {
    return relative(realpathSync(cwd), realpathSync(path)) || ".";
  } catch {
    return relative(cwd, path) || ".";
  }
}

export function revisionOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function workspaceIgnore(cwd: string): Promise<(path: string) => boolean> {
  const matcher = ignore();
  try {
    matcher.add(await readFile(resolve(cwd, ".gitignore"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return (path: string) => {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
    return normalized.length > 0 && matcher.ignores(normalized);
  };
}

export function assertSafeGlob(pattern: string): void {
  if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
    throw new AgentError(`Glob escapes workspace: ${pattern}`, "tool");
  }
}
