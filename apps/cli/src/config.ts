import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import type { NodeRuntimeConfig, ProviderKind, ThinkingMode } from "@fidoo/node-runtime";
import { parseProviderKind, resolveProviderConnection } from "@fidoo/node-runtime";
import { providerDefinition } from "@fidoo/protocol";

export type OutputFormat = "text" | "json" | "jsonl";

export interface GlobalOptions {
  cwd: string;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  thinking?: ThinkingMode;
  yes?: boolean;
  readOnly?: boolean;
  policy?: string;
  output: OutputFormat;
  maxIterations: string;
}

export interface RuntimeConfig extends NodeRuntimeConfig {
  output: OutputFormat;
}

export function dataHome(): string {
  return process.env.FIDOO_HOME ?? join(homedir(), ".fidoo");
}

export function resolveRuntimeConfig(
  options: GlobalOptions,
  allowUnconfigured = false,
): RuntimeConfig {
  const provider = options.provider ?? parseProvider(process.env.FIDOO_PROVIDER);
  const connection = resolveProviderConnection(
    {
      provider,
      ...(options.model ? { model: options.model } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
    },
    dataHome(),
  );
  const { model, apiKey, thinking } = connection;
  if (!allowUnconfigured && !model) {
    throw new AgentError("Set --model or FIDOO_MODEL", "configuration");
  }
  if (!allowUnconfigured && providerDefinition(provider).apiKeyRequired && !apiKey) {
    const variable = providerDefinition(provider).apiKeyEnv[0] ?? "FIDOO_API_KEY";
    throw new AgentError(`Set FIDOO_API_KEY or ${variable}`, "configuration");
  }
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
    dataHome: dataHome(),
    autoApprove: options.yes ?? false,
    readOnly: options.readOnly ?? false,
    ...(options.policy ? { policyFile: options.policy } : {}),
    maxIterations,
    output: options.output,
  };
}

export function serverArguments(config: RuntimeConfig): string[] {
  return [
    "--cwd",
    config.cwd,
    "--provider",
    config.provider,
    "--model",
    config.model,
    "--max-iterations",
    String(config.maxIterations),
    ...(config.baseURL ? ["--base-url", config.baseURL] : []),
    ...(config.policyFile ? ["--policy", config.policyFile] : []),
    ...(config.provider === "deepseek" ? ["--thinking", config.thinking] : []),
    ...(config.autoApprove ? ["--yes"] : []),
    ...(config.readOnly ? ["--read-only"] : []),
  ];
}

export function parseProvider(value: string | undefined): ProviderKind {
  return parseProviderKind(value);
}

export function parseThinking(value: string | undefined): ThinkingMode {
  if (!value || value === "enabled") {
    return "enabled";
  }
  if (value === "disabled") {
    return "disabled";
  }
  throw new AgentError("Thinking must be enabled or disabled", "configuration");
}
