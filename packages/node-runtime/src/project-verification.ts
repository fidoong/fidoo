import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentError, type RequiredCheck } from "@fidoo/core";
import { z } from "zod";

const requiredCheckSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(600000).optional(),
  paths: z.array(z.string().min(1)).optional(),
});

const projectConfigSchema = z.strictObject({
  verification: z
    .strictObject({
      requiredChecks: z.array(requiredCheckSchema).default([]),
    })
    .default({ requiredChecks: [] }),
});

export async function loadRequiredChecks(cwd: string): Promise<RequiredCheck[]> {
  const path = join(cwd, ".fidoo.json");
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new AgentError(
      `Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "configuration",
    );
  }
  const parsed = projectConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentError(`Invalid ${path}: ${parsed.error.issues[0]?.message}`, "configuration");
  }
  const checks = parsed.data.verification.requiredChecks;
  const ids = new Set<string>();
  for (const check of checks) {
    if (ids.has(check.id)) {
      throw new AgentError(
        `Invalid ${path}: duplicate required check id ${check.id}`,
        "configuration",
      );
    }
    ids.add(check.id);
  }
  return checks.map((check) => ({
    id: check.id,
    command: check.command,
    args: check.args,
    ...(check.cwd !== undefined ? { cwd: check.cwd } : {}),
    ...(check.timeoutMs !== undefined ? { timeoutMs: check.timeoutMs } : {}),
    ...(check.paths !== undefined ? { paths: check.paths } : {}),
  }));
}
