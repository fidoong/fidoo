import type { PermissionMode } from "@fidoo/core";
import type { ProviderKind } from "@fidoo/protocol";
import type { SandboxMode } from "./adapters/execution/types.js";
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
  readOnly: boolean;
  dontAsk?: boolean;
  bypassPermissions?: boolean;
  policyFile?: string;
  sandbox?: SandboxMode;
  mode?: Exclude<PermissionMode, "read-only">;
  maxIterations: number;
  maxContextTokens?: number;
}
