export type SandboxMode = "off" | "auto" | "required";
export type SandboxNetwork = "deny" | "allow";
export type SandboxBackend = "direct" | "seatbelt" | "bubblewrap";

export interface ExecutionConfig {
  mode: SandboxMode;
  network: SandboxNetwork;
  environment: {
    allow: string[];
    set: Record<string, string>;
  };
}

export interface PrepareCommandInput {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  workspace?: string;
}

export interface PreparedCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  backend: SandboxBackend;
  network: SandboxNetwork | "unchanged";
  warning?: string;
}
