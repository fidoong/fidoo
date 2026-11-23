import { z } from "zod";

export const PROVIDER_IDS = [
  "openai",
  "deepseek",
  "kimi",
  "kimi-code",
  "qwen",
  "zhipu",
  "xai",
  "openrouter",
  "anthropic",
  "gemini",
  "custom",
] as const;

export type ProviderKind = (typeof PROVIDER_IDS)[number];
export type ProviderProtocol = "openai" | "anthropic" | "gemini";

export interface ProviderDefinition {
  id: ProviderKind;
  name: string;
  protocol: ProviderProtocol;
  defaultModel: string;
  models: string[];
  defaultBaseURL: string;
  apiKeyEnv: string[];
  apiKeyRequired: boolean;
  baseURLRequired: boolean;
  supportsThinking: boolean;
}

export const PROVIDER_CATALOG: Record<ProviderKind, ProviderDefinition> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    defaultModel: "gpt-4.1",
    models: ["gpt-4.1", "gpt-4.1-mini", "o3"],
    defaultBaseURL: "https://api.openai.com/v1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"],
    defaultBaseURL: "https://api.deepseek.com",
    apiKeyEnv: ["DEEPSEEK_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: true,
  },
  kimi: {
    id: "kimi",
    name: "Kimi / Moonshot",
    protocol: "openai",
    defaultModel: "kimi-k2-0905-preview",
    models: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview", "moonshot-v1-128k"],
    defaultBaseURL: "https://api.moonshot.cn/v1",
    apiKeyEnv: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  "kimi-code": {
    id: "kimi-code",
    name: "Kimi Code (Membership)",
    protocol: "openai",
    defaultModel: "k3.1-pro",
    models: [
      "k3.1-pro",
      "k3.1-pro-highspeed",
      "k3",
      "k3-256k",
      "kimi-for-coding",
      "kimi-for-coding-highspeed",
    ],
    defaultBaseURL: "https://api.kimi.com/coding/v1",
    apiKeyEnv: ["KIMI_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: true,
  },
  qwen: {
    id: "qwen",
    name: "Qwen / DashScope",
    protocol: "openai",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"],
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: ["DASHSCOPE_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  zhipu: {
    id: "zhipu",
    name: "Zhipu GLM",
    protocol: "openai",
    defaultModel: "glm-4.6",
    models: ["glm-4.6", "glm-4.5", "glm-4-air"],
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: ["ZHIPUAI_API_KEY", "GLM_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  xai: {
    id: "xai",
    name: "xAI Grok",
    protocol: "openai",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-3", "grok-code-fast-1"],
    defaultBaseURL: "https://api.x.ai/v1",
    apiKeyEnv: ["XAI_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    defaultModel: "openai/gpt-4.1",
    models: [
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat-v3-0324",
    ],
    defaultBaseURL: "https://openrouter.ai/v1",
    apiKeyEnv: ["OPENROUTER_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    defaultModel: "claude-sonnet-4-5-20250929",
    models: ["claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805", "claude-haiku-4-5-20251001"],
    defaultBaseURL: "https://api.anthropic.com",
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    protocol: "gemini",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    defaultBaseURL: "https://generativelanguage.googleapis.com",
    apiKeyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    apiKeyRequired: true,
    baseURLRequired: false,
    supportsThinking: false,
  },
  custom: {
    id: "custom",
    name: "Custom OpenAI-compatible",
    protocol: "openai",
    defaultModel: "",
    models: [],
    defaultBaseURL: "",
    apiKeyEnv: [],
    apiKeyRequired: false,
    baseURLRequired: true,
    supportsThinking: false,
  },
};

export const providerKindSchema = z.enum(PROVIDER_IDS);
export const thinkingModeSchema = z.enum(["enabled", "disabled"]);

export const providerSettingsSchema = z.object({
  provider: providerKindSchema,
  model: z.string(),
  baseURL: z.string(),
  hasApiKey: z.boolean(),
  configured: z.boolean(),
  contextLimit: z.number().int().positive(),
  thinking: thinkingModeSchema,
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const settingsUpdateParamsSchema = z.object({
  provider: providerKindSchema,
  model: z.string(),
  baseURL: z.string(),
  apiKey: z.string().optional(),
  thinking: thinkingModeSchema.optional(),
  save: z.boolean().default(true),
});
export type SettingsUpdateParams = z.input<typeof settingsUpdateParamsSchema>;

export const providerModelsParamsSchema = z.object({
  provider: providerKindSchema,
  baseURL: z.string(),
  apiKey: z.string().optional(),
});
export type ProviderModelsParams = z.input<typeof providerModelsParamsSchema>;
export const providerModelsResultSchema = z.object({
  models: z.array(z.string()),
  unavailable: z.boolean().optional(),
});

export function normalizeProviderBaseURL(provider: ProviderKind, value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  try {
    const url = new URL(trimmed);
    if (
      (provider === "kimi" || provider === "kimi-code") &&
      (url.hostname === "api.kimi.com" || url.hostname === "api.kimi.ai") &&
      url.pathname === "/coding"
    ) {
      url.pathname = "/coding/v1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

export function providerDefinition(value: ProviderKind): ProviderDefinition {
  return PROVIDER_CATALOG[value];
}
