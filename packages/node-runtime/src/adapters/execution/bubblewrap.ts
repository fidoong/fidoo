import type { SandboxNetwork } from "./types.js";

export function bubblewrapCommand(options: {
  executable: string;
  workspace: string;
  runRoot: string;
  cwd: string;
  readPaths: readonly string[];
  network: SandboxNetwork;
  env: NodeJS.ProcessEnv;
  command: string;
  args: readonly string[];
}): { command: string; args: string[] } {
  const args = [
    "--die-with-parent",
    ...(options.network === "deny" ? ["--unshare-net"] : []),
    "--clearenv",
    ...Object.entries(options.env).flatMap(([name, value]) =>
      value === undefined ? [] : ["--setenv", name, value],
    ),
    ...options.readPaths.flatMap((path) => ["--ro-bind", path, path]),
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    options.workspace,
    options.workspace,
    "--bind",
    options.runRoot,
    options.runRoot,
    "--chdir",
    options.cwd,
    options.command,
    ...options.args,
  ];
  return { command: options.executable, args };
}
