import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import type { NodeRuntimeConfig, ProviderKind, ThinkingMode } from "@fidoo/node-runtime";
import { parseProviderKind, resolveProviderConnection } from "@fidoo/node-runtime";

export interface ServerOptions {
  stdio?: boolean;
  cwd: string;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  thinking?: ThinkingMode;
  yes?: boolean;
  readOnly?: boolean;
  policy?: string;
  maxIterations: string;
}

export function resolveServerConfig(options: ServerOptions): NodeRuntimeConfig {
  const dataHome = process.env.FIDOO_HOME ?? join(homedir(), ".fidoo");
  const provider = options.provider ?? parseProvider(process.env.FIDOO_PROVIDER);
  const connection = resolveProviderConnection(
    {
      provider,
      ...(options.model ? { model: options.model } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
    },
    dataHome,
  );
  const thinking = connection.thinking;
  if (provider !== "deepseek" && (options.thinking ?? process.env.FIDOO_THINKING)) {
    throw new AgentError("--thinking is only supported with --provider deepseek", "configuration");
  }
  if (options.yes && options.readOnly) {
    throw new AgentError("--yes and --read-only cannot be used together", "configuration");
  }
  const maxIterations = Number.parseInt(options.maxIterations, 10);
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 200) {
    throw new AgentError("--max-iterations must be between 1 and 200", "configuration");
  }
  return {
    cwd: resolve(options.cwd),
    ...connection,
    thinking,
    dataHome,
    autoApprove: options.yes ?? false,
    readOnly: options.readOnly ?? false,
    ...(options.policy ? { policyFile: options.policy } : {}),
    maxIterations,
  };
}

function parseProvider(value: string | undefined): ProviderKind {
  return parseProviderKind(value);
}
