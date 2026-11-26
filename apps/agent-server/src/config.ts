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
import type { PermissionMode } from "@fidoo/protocol";

export interface ServerOptions {
  stdio?: boolean;
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
  maxIterations: string;
}

export function resolveServerConfig(options: ServerOptions): NodeRuntimeConfig {
  const dataHome = process.env.FIDOO_HOME ?? join(homedir(), ".fidoo");
  const connection = resolveProviderConnection(
    {
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
    },
    dataHome,
  );
  const thinking = connection.thinking;
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
    dataHome,
    readOnly: options.readOnly ?? false,
    dontAsk: options.dontAsk ?? false,
    bypassPermissions: options.dangerouslyBypassPermissions ?? false,
    ...(options.policy ? { policyFile: options.policy } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    maxIterations,
  };
}
