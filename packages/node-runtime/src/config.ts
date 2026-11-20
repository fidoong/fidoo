import type { ThinkingMode } from "./adapters/models/deepseek.js";

export type ProviderKind = "openai" | "deepseek";

export interface NodeRuntimeConfig {
  cwd: string;
  provider: ProviderKind;
  model: string;
  apiKey: string;
  baseURL?: string;
  thinking: ThinkingMode;
  dataHome: string;
  autoApprove: boolean;
  readOnly: boolean;
  maxIterations: number;
}
