import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type AgentClient, createAgentClient } from "./agent-client.js";
import { ReconnectingStdioTransport } from "./reconnecting-stdio-transport.js";
import { AgentProtocolError, StdioTransport } from "./stdio-transport.js";

export interface AgentServerConnection {
  client: AgentClient;
  transport: ReconnectingStdioTransport;
  process: ChildProcess;
  close(): Promise<void>;
}

export interface ConnectAgentServerOptions {
  command?: string;
  args?: string[];
  serverArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function connectAgentServer(options: ConnectAgentServerOptions = {}): AgentServerConnection {
  const command = options.command ?? process.execPath;
  const args = options.args ?? defaultServerArguments(options.serverArgs);
  let child: ChildProcess;
  let transport: ReconnectingStdioTransport;
  const open = () => {
    child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    if (!child.stdin || !child.stdout) {
      throw new Error("Agent server stdio pipes are unavailable");
    }
    const next = new StdioTransport(child.stdout, child.stdin);
    const disconnected = (cause: unknown) => transport?.disconnect(next, cause);
    child.once("error", disconnected);
    child.once("exit", (code, signal) => {
      next.abort(new AgentProtocolError("Agent server exited", -32000));
      disconnected(
        new AgentProtocolError(`Agent server exited (${signal ?? code ?? "unknown"})`, -32000),
      );
    });
    return next;
  };
  transport = new ReconnectingStdioTransport(open(), open);
  return {
    client: createAgentClient(transport),
    transport,
    get process() {
      return child;
    },
    async close() {
      transport.close();
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    },
  };
}

export function defaultServerArguments(serverArgs: readonly string[] = []): string[] {
  return [defaultServerEntry(), "--stdio", ...serverArgs];
}

function defaultServerEntry(): string {
  return (
    process.env.FIDOO_SERVER_ENTRY ??
    fileURLToPath(new URL("../../../apps/agent-server/dist/index.js", import.meta.url))
  );
}

export { ReconnectingStdioTransport } from "./reconnecting-stdio-transport.js";
export { AgentProtocolError, StdioTransport } from "./stdio-transport.js";
