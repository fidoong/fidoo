import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentError, errorMessage } from "@fidoo/core";
import { z } from "zod";
import type { ExecutionConfig, SandboxMode } from "./types.js";

const environmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const executionConfigSchema = z.strictObject({
  mode: z.enum(["off", "auto", "required"]).default("auto"),
  network: z.enum(["deny", "allow"]).default("deny"),
  environment: z
    .strictObject({
      allow: z.array(environmentName).default([]),
      set: z.record(environmentName, z.string()).default({}),
    })
    .default({ allow: [], set: {} }),
});

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: "auto",
  network: "deny",
  environment: { allow: [], set: {} },
};

export const DIRECT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: "off",
  network: "allow",
  environment: { allow: [], set: {} },
};

export async function loadExecutionConfig(
  dataHome: string,
  override?: SandboxMode,
): Promise<ExecutionConfig> {
  const path = join(dataHome, "execution.json");
  let config = DEFAULT_EXECUTION_CONFIG;
  try {
    const source = await readFile(path, "utf8");
    config = executionConfigSchema.parse(JSON.parse(source));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new AgentError(
        `Invalid execution config ${path}: ${errorMessage(error)}`,
        "configuration",
      );
    }
  }
  return {
    ...config,
    mode: override ?? config.mode,
    environment: {
      allow: [...config.environment.allow],
      set: { ...config.environment.set },
    },
  };
}
