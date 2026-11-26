import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import type {
  NodeRuntimeConfig,
  ProviderKind,
  SandboxMode,
  ThinkingMode,
} from "@fidoo/node-runtime";
import { resolveProviderConnection } from "@fidoo/node-runtime";
import { type PermissionMode, providerDefinition } from "@fidoo/protocol";

export type OutputFormat = "text" | "json" | "jsonl";

export interface GlobalOptions {
  cwd: string;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  thinking?: ThinkingMode;
  readOnly?: boolean;
  dontAsk?: boolean;
  dangerouslyBypassPermissions?: boolean;
  policy?: string;
  sandbox?: SandboxMode;
  mode?: Exclude<PermissionMode, "read-only">;
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
  const connection = resolveProviderConnection(
    {
      ...(options.provider ? { provider: options.provider } : {}),
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
  if (!allowUnconfigured && providerDefinition(connection.provider).apiKeyRequired && !apiKey) {
    const variable = providerDefinition(connection.provider).apiKeyEnv[0] ?? "FIDOO_API_KEY";
    throw new AgentError(`Set FIDOO_API_KEY or ${variable}`, "configuration");
  }
  if (connection.provider !== "deepseek" && (options.thinking ?? process.env.FIDOO_THINKING)) {
    throw new AgentError("--thinking is only supported with --provider deepseek", "configuration");
  }
  if (options.readOnly && options.mode === "auto") {
    throw new AgentError("--read-only cannot be combined with --mode auto", "configuration");
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
    readOnly: options.readOnly ?? false,
    dontAsk: options.dontAsk ?? false,
    bypassPermissions: options.dangerouslyBypassPermissions ?? false,
    ...(options.policy ? { policyFile: options.policy } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
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
    ...(config.sandbox ? ["--sandbox", config.sandbox] : []),
    ...(config.mode ? ["--mode", config.mode] : []),
    ...(config.provider === "deepseek" ? ["--thinking", config.thinking] : []),
    ...(config.readOnly ? ["--read-only"] : []),
    ...(config.dontAsk ? ["--dont-ask"] : []),
    ...(config.bypassPermissions ? ["--dangerously-bypass-permissions"] : []),
  ];
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
