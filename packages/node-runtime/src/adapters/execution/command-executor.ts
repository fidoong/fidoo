import { constants } from "node:fs";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { AgentError } from "@fidoo/core";
import { bubblewrapCommand } from "./bubblewrap.js";
import { DIRECT_EXECUTION_CONFIG } from "./config.js";
import { isolatedEnvironment } from "./environment.js";
import { seatbeltCommand, seatbeltProfile } from "./seatbelt.js";
import type {
  ExecutionConfig,
  PrepareCommandInput,
  PreparedCommand,
  SandboxBackend,
} from "./types.js";

interface SandboxInstallation {
  backend: Exclude<SandboxBackend, "direct">;
  executable: string;
}

export class CommandExecutor {
  private installation: Promise<SandboxInstallation | undefined> | undefined;

  constructor(
    private readonly config: ExecutionConfig = DIRECT_EXECUTION_CONFIG,
    private readonly root = join(tmpdir(), "fidoo-execution"),
  ) {}

  async prepare(
    input: PrepareCommandInput,
    baseEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<PreparedCommand> {
    if (!/^[A-Za-z0-9_-]+$/.test(input.runId)) {
      throw new AgentError("Invalid run id for command execution", "configuration");
    }
    const runRoot = await this.prepareRunRoot(input.runId);
    const workspace = await realpath(input.workspace ?? input.cwd);
    const cwd = await realpath(input.cwd);
    const home = join(runRoot, "home");
    const temporaryDirectory = join(runRoot, "tmp");
    await Promise.all([
      mkdir(home, { recursive: true, mode: 0o700 }),
      mkdir(temporaryDirectory, { recursive: true, mode: 0o700 }),
    ]);
    const env = isolatedEnvironment({
      base: baseEnv,
      allow: this.config.environment.allow,
      set: this.config.environment.set,
      home,
      temporaryDirectory,
    });
    if (this.config.mode === "off") {
      return {
        command: input.command,
        args: [...input.args],
        env,
        backend: "direct",
        network: "unchanged",
      };
    }

    const installation = await this.findInstallation();
    if (!installation) {
      if (this.config.mode === "required") {
        throw new AgentError(
          `OS sandbox is required but unavailable on ${process.platform}. Configure Seatbelt on macOS or Bubblewrap on Linux/WSL2. Native Windows supports direct execution only; run Fidoo inside WSL2 for sandboxing, or explicitly set execution.mode=auto/off.`,
          "configuration",
        );
      }
      return {
        command: input.command,
        args: [...input.args],
        env,
        backend: "direct",
        network: "unchanged",
        warning:
          "OS sandbox is unavailable; command is running with environment isolation but without filesystem/network sandboxing",
      };
    }

    const readPaths = await executableReadPaths(input.command, cwd, env.PATH ?? "");
    if (installation.backend === "seatbelt") {
      await writeFile(
        join(runRoot, "profile.sb"),
        `${seatbeltProfile({ workspace, runRoot, readPaths, network: this.config.network })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      return {
        ...seatbeltCommand(runRoot, input.command, input.args),
        env,
        backend: "seatbelt",
        network: this.config.network,
      };
    }

    const existingReadPaths = await existingPaths([
      "/usr",
      "/bin",
      "/sbin",
      "/lib",
      "/lib64",
      "/etc",
      "/opt",
      ...readPaths,
    ]);
    return {
      ...bubblewrapCommand({
        executable: installation.executable,
        workspace,
        runRoot,
        cwd,
        readPaths: existingReadPaths,
        network: this.config.network,
        env,
        command: input.command,
        args: input.args,
      }),
      env,
      backend: "bubblewrap",
      network: this.config.network,
    };
  }

  private async prepareRunRoot(runId: string): Promise<string> {
    const path = join(this.root, "sandboxes", runId);
    await mkdir(path, { recursive: true, mode: 0o700 });
    return realpath(path);
  }

  private findInstallation(): Promise<SandboxInstallation | undefined> {
    this.installation ??= detectSandboxInstallation();
    return this.installation;
  }
}

export async function detectSandboxInstallation(
  platform: NodeJS.Platform = process.platform,
): Promise<SandboxInstallation | undefined> {
  if (platform === "darwin" && (await executable("/usr/bin/sandbox-exec"))) {
    return { backend: "seatbelt", executable: "/usr/bin/sandbox-exec" };
  }
  if (platform === "linux") {
    for (const candidate of ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]) {
      if (await executable(candidate)) return { backend: "bubblewrap", executable: candidate };
    }
  }
  return undefined;
}

async function executableReadPaths(command: string, cwd: string, path: string): Promise<string[]> {
  const candidates = [process.execPath];
  if (command.includes("/") || command.includes("\\")) {
    candidates.push(resolve(cwd, command));
  } else {
    for (const directory of path.split(delimiter)) {
      if (directory) candidates.push(resolve(cwd, directory, command));
    }
  }
  const roots = new Set<string>();
  for (const candidate of candidates) {
    try {
      const executablePath = await realpath(candidate);
      await access(executablePath, constants.X_OK);
      const directory = dirname(executablePath);
      roots.add(basename(directory) === "bin" ? dirname(directory) : directory);
    } catch {}
  }
  return [...roots];
}

async function existingPaths(paths: readonly string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const path of new Set(paths)) {
    try {
      await access(path);
      existing.push(path);
    } catch {}
  }
  return existing;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
