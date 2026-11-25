import { execa } from "execa";

export function terminateProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      void execa("taskkill", ["/pid", String(pid), "/t", "/f"], {
        reject: false,
        extendEnv: false,
        env: windowsSystemEnvironment(),
      }).catch(() => undefined);
    } else {
      try {
        process.kill(pid, signal);
      } catch {}
    }
  } else {
    try {
      process.kill(-pid, signal);
    } catch {}
  }
}

function windowsSystemEnvironment(): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return {
    SystemRoot: systemRoot,
    PATH: `${systemRoot}\\System32;${systemRoot}`,
  };
}
