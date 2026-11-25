import { dirname, join } from "node:path";
import type { SandboxNetwork } from "./types.js";

export function seatbeltProfile(options: {
  workspace: string;
  runRoot: string;
  readPaths: readonly string[];
  network: SandboxNetwork;
}): string {
  const readPaths = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/Applications",
    "/opt/homebrew",
    "/opt/local",
    "/private/etc",
    "/dev",
    ...options.readPaths,
    options.workspace,
    options.runRoot,
  ];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow mach*)",
    "(allow sysctl-read)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    `(allow file-read-data ${ancestorPaths([
      options.workspace,
      options.runRoot,
      ...options.readPaths,
    ])
      .map((path) => `(literal "${schemeString(path)}")`)
      .join(" ")})`,
    `(allow file-read* ${readPaths.map((path) => `(subpath "${schemeString(path)}")`).join(" ")})`,
    `(allow file-write* (subpath "${schemeString(options.workspace)}") (subpath "${schemeString(options.runRoot)}") (literal "/dev/null") (literal "/dev/tty"))`,
    ...(options.network === "allow" ? ["(allow network*)"] : []),
  ].join("\n");
}

export function seatbeltCommand(
  runRoot: string,
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-f", join(runRoot, "profile.sb"), command, ...args],
  };
}

function ancestorPaths(paths: readonly string[]): string[] {
  const ancestors = new Set<string>();
  for (const path of paths) {
    let current = path;
    while (true) {
      ancestors.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...ancestors];
}

function schemeString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
