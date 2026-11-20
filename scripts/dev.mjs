import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = process.argv.slice(2);
const debug = args[0] === "--debug";
if (debug) {
  args.shift();
}

let cli;
let build;
let restartTimer;
let restarting = false;
let pendingBuild = false;
let shuttingDown = false;
const watchers = [];

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

try {
  if (!(await runBuild())) {
    process.exitCode = 1;
  } else {
    startWatchers();
    startCli();
  }
} catch (error) {
  process.stderr.write(`Dev startup failed: ${errorMessage(error)}\n`);
  await shutdown(1);
}

function startWatchers() {
  for (const directory of ["apps", "packages"]) {
    const watcher = watch(
      new URL(`../${directory}/`, import.meta.url),
      { recursive: true },
      (_event, filename) => {
        const path = filename?.toString().replaceAll("\\", "/") ?? "";
        if (!path.includes("/src/") || !/\.(?:ts|tsx)$/.test(path)) {
          return;
        }
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => void hotRestart(), 200);
      },
    );
    watcher.on("error", (error) => {
      process.stderr.write(`Watch failed: ${errorMessage(error)}\n`);
      void shutdown(1);
    });
    watchers.push(watcher);
  }
  process.stderr.write("Watching apps/*/src and packages/*/src. Save a file to restart.\n");
}

async function hotRestart() {
  if (shuttingDown) {
    return;
  }
  if (restarting) {
    pendingBuild = true;
    return;
  }
  restarting = true;
  await stopCli();
  let succeeded = false;
  do {
    pendingBuild = false;
    succeeded = await runBuild();
  } while (pendingBuild && !shuttingDown);
  if (succeeded && !shuttingDown) {
    process.stderr.write("Restarting CLI and agent-server...\n");
    startCli();
  } else if (!shuttingDown) {
    process.stderr.write("Build failed. Fix the error and save again to retry.\n");
  }
  restarting = false;
}

function startCli() {
  const env = { ...process.env };
  if (debug) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --inspect=0`.trim();
    process.stderr.write("Inspector enabled for CLI and agent-server on random ports.\n");
  }
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url)), ...args],
    {
      cwd: root,
      env,
      stdio: "inherit",
    },
  );
  cli = child;
  child.once("error", (error) => {
    process.stderr.write(`CLI failed to start: ${errorMessage(error)}\n`);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (cli !== child || restarting || shuttingDown) {
      return;
    }
    cli = undefined;
    void shutdown(code ?? (signal ? 1 : 0));
  });
}

async function stopCli() {
  const child = cli;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    cli = undefined;
    return;
  }
  cli = undefined;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timeout);
}

function runBuild() {
  if (build) {
    return Promise.resolve(false);
  }
  process.stderr.write("Building workspace...\n");
  const child = spawn(pnpm, ["build"], { cwd: root, stdio: "inherit" });
  build = child;
  return new Promise((resolve) => {
    child.once("error", (error) => {
      process.stderr.write(`Build failed to start: ${errorMessage(error)}\n`);
      build = undefined;
      resolve(false);
    });
    child.once("exit", (code) => {
      build = undefined;
      resolve(code === 0);
    });
  });
}

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers.splice(0)) {
    watcher.close();
  }
  build?.kill("SIGTERM");
  await stopCli();
  process.exitCode = code;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
