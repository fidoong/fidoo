import type { ProviderKind } from "@fidoo/protocol";
import type { ThinkingMode } from "./adapters/models/deepseek.js";

export type { ProviderKind } from "@fidoo/protocol";

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
  policyFile?: string;
  maxIterations: number;
  maxContextTokens?: number;
}
