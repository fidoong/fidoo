import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import type { NodeRuntimeConfig, ProviderKind, ThinkingMode } from "@fidoo/node-runtime";

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
    dataHome: process.env.FIDOO_HOME ?? join(homedir(), ".fidoo"),
    autoApprove: options.yes ?? false,
    readOnly: options.readOnly ?? false,
    ...(options.policy ? { policyFile: options.policy } : {}),
    maxIterations,
  };
}

function parseProvider(value: string | undefined): ProviderKind {
  if (!value) {
    return "openai";
  }
  if (value === "openai" || value === "deepseek") {
    return value;
  }
  throw new AgentError("Provider must be openai or deepseek", "configuration");
}

function parseThinking(value: string | undefined): ThinkingMode {
  if (!value) {
    return "enabled";
  }
  if (value === "enabled" || value === "disabled") {
    return value;
  }
  throw new AgentError("Thinking must be enabled or disabled", "configuration");
}
