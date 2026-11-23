import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentError } from "@fidoo/core";
import {
  normalizeProviderBaseURL,
  type ProviderKind,
  type ProviderSettings,
  providerDefinition,
  providerKindSchema,
  thinkingModeSchema,
} from "@fidoo/protocol";
import { z } from "zod";
import type { ThinkingMode } from "./adapters/models/deepseek.js";
import type { NodeRuntimeConfig } from "./config.js";

const storedProviderConfigSchema = z.object({
  provider: providerKindSchema,
  model: z.string(),
  baseURL: z.string(),
  apiKey: z.string(),
  thinking: thinkingModeSchema,
});

export interface ProviderConnectionOptions {
  provider?: ProviderKind;
  model?: string;
  baseURL?: string;
  thinking?: ThinkingMode;
}

export function parseProviderKind(value: string | undefined): ProviderKind {
  if (!value) return "openai";
  const parsed = providerKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentError(
      `Provider must be one of: ${providerKindSchema.options.join(", ")}`,
      "configuration",
    );
  }
  return parsed.data;
}

export function resolveProviderConnection(
  options: ProviderConnectionOptions,
  dataHome: string,
  env: NodeJS.ProcessEnv = process.env,
): Pick<NodeRuntimeConfig, "provider" | "model" | "apiKey" | "baseURL" | "thinking"> {
  const saved = readProviderConnection(dataHome);
  const provider = parseProviderKind(options.provider ?? env.FIDOO_PROVIDER ?? saved?.provider);
  const definition = providerDefinition(provider);
  const useSaved = saved?.provider === provider;
  const environmentKey = definition.apiKeyEnv.map((key) => env[key]).find(Boolean);
  return {
    provider,
    model:
      options.model ??
      env.FIDOO_MODEL ??
      (useSaved ? saved.model : undefined) ??
      definition.defaultModel,
    apiKey: env.FIDOO_API_KEY ?? environmentKey ?? (useSaved ? saved.apiKey : undefined) ?? "",
    baseURL: normalizeProviderBaseURL(
      provider,
      options.baseURL ??
        env.FIDOO_BASE_URL ??
        legacyBaseURL(provider, env) ??
        (useSaved ? saved.baseURL : undefined) ??
        definition.defaultBaseURL,
    ),
    thinking: options.thinking ?? (useSaved ? saved.thinking : undefined) ?? "enabled",
  };
}

export function readProviderConnection(dataHome: string): NodeRuntimeConfig | undefined {
  try {
    const parsed = storedProviderConfigSchema.parse(
      JSON.parse(readFileSync(providerConfigPath(dataHome), "utf8")),
    );
    return parsed as NodeRuntimeConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AgentError(
      `Invalid model config at ${providerConfigPath(dataHome)}`,
      "configuration",
    );
  }
}

export async function writeProviderConnection(config: NodeRuntimeConfig): Promise<void> {
  const value = storedProviderConfigSchema.parse({
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL ?? providerDefinition(config.provider).defaultBaseURL,
    apiKey: config.apiKey,
    thinking: config.thinking,
  });
  await mkdir(config.dataHome, { recursive: true, mode: 0o700 });
  const path = providerConfigPath(config.dataHome);
  const temporary = join(config.dataHome, `.models-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function toProviderSettings(config: NodeRuntimeConfig): ProviderSettings {
  const definition = providerDefinition(config.provider);
  const baseURL = config.baseURL ?? definition.defaultBaseURL;
  return {
    provider: config.provider,
    model: config.model,
    baseURL,
    hasApiKey: Boolean(config.apiKey),
    configured: Boolean(
      config.model.trim() &&
        baseURL &&
        (!definition.baseURLRequired || config.baseURL) &&
        (!definition.apiKeyRequired || config.apiKey),
    ),
    contextLimit: config.maxContextTokens ?? 100_000,
    thinking: config.thinking,
  };
}

function legacyBaseURL(provider: ProviderKind, env: NodeJS.ProcessEnv): string | undefined {
  const variables: Partial<Record<ProviderKind, string[]>> = {
    openai: ["OPENAI_BASE_URL"],
    deepseek: ["DEEPSEEK_BASE_URL"],
    kimi: ["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
    qwen: ["DASHSCOPE_BASE_URL"],
    anthropic: ["ANTHROPIC_BASE_URL"],
    gemini: ["GEMINI_BASE_URL", "GOOGLE_BASE_URL"],
  };
  return variables[provider]?.map((key) => env[key]).find(Boolean);
}

function providerConfigPath(dataHome: string): string {
  return join(dataHome, "models.json");
}
