import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import type { NodeRuntimeConfig, ProviderKind, ThinkingMode } from "@fidoo/node-runtime";

export type OutputFormat = "text" | "json" | "jsonl";

export interface GlobalOptions {
  cwd: string;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  thinking?: ThinkingMode;
  yes?: boolean;
  readOnly?: boolean;
  output: OutputFormat;
  maxIterations: string;
}

export interface RuntimeConfig extends NodeRuntimeConfig {
  output: OutputFormat;
}

export function dataHome(): string {
  return process.env.FIDOO_HOME ?? join(homedir(), ".fidoo");
}

export function resolveRuntimeConfig(options: GlobalOptions): RuntimeConfig {
  const provider = parseProvider(options.provider ?? process.env.FIDOO_PROVIDER);
  const model =
    options.model ??
    process.env.FIDOO_MODEL ??
    (provider === "deepseek" ? "deepseek-flash" : undefined);
  const apiKey =
    process.env.FIDOO_API_KEY ??
    (provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY);
  const thinking = parseThinking(options.thinking ?? process.env.FIDOO_THINKING);
  if (!model) {
    throw new AgentError("Set --model or FIDOO_MODEL", "configuration");
  }
  if (!apiKey) {
    const variable = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
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
  const baseURL =
    options.baseUrl ??
    process.env.FIDOO_BASE_URL ??
    (provider === "deepseek" ? process.env.DEEPSEEK_BASE_URL : process.env.OPENAI_BASE_URL);
  return {
    cwd: resolve(options.cwd),
    provider,
    model,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    thinking,
    dataHome: dataHome(),
    autoApprove: options.yes ?? false,
    readOnly: options.readOnly ?? false,
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
    ...(config.provider === "deepseek" ? ["--thinking", config.thinking] : []),
    ...(config.autoApprove ? ["--yes"] : []),
    ...(config.readOnly ? ["--read-only"] : []),
  ];
}

export function parseProvider(value: string | undefined): ProviderKind {
  if (!value || value === "openai") {
    return "openai";
  }
  if (value === "deepseek") {
    return "deepseek";
  }
  throw new AgentError("Provider must be openai or deepseek", "configuration");
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
