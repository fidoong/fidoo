import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackgroundTaskManager,
  bubblewrapCommand,
  CommandExecutor,
  createBashTool,
  detectSandboxInstallation,
  isolatedEnvironment,
  loadExecutionConfig,
} from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../helpers/tool.js";

const directories: string[] = [];
const managers: BackgroundTaskManager[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const manager of managers.splice(0)) {
    for (const task of await manager.list()) {
      if (task.status === "running") await manager.stop(task.taskId);
    }
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("command execution isolation", () => {
  it("builds a minimal environment with explicit additions and isolated directories", () => {
    const env = isolatedEnvironment({
      base: {
        PATH: "/custom/bin",
        FIDOO_API_KEY: "secret",
        CUSTOM_FLAG: "allowed",
      },
      allow: ["CUSTOM_FLAG"],
      set: { CI: "true", CUSTOM_FLAG: "overridden" },
      home: "/sandbox/home",
      temporaryDirectory: "/sandbox/tmp",
    });
    expect(env).toEqual({
      PATH: "/custom/bin",
      CUSTOM_FLAG: "overridden",
      CI: "true",
      HOME: "/sandbox/home",
      TMPDIR: "/sandbox/tmp",
    });
    expect(env.FIDOO_API_KEY).toBeUndefined();
  });

  it("handles Windows environment casing and isolates USERPROFILE, TMP and TEMP", () => {
    const env = isolatedEnvironment({
      base: {
        Path: "C:\\Tools",
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        SECRET_TOKEN: "secret",
      },
      home: "C:\\sandbox\\home",
      temporaryDirectory: "C:\\sandbox\\tmp",
      platform: "win32",
    });
    expect(env).toMatchObject({
      PATH: "C:\\Tools",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      HOME: "C:\\sandbox\\home",
      USERPROFILE: "C:\\sandbox\\home",
      TMPDIR: "C:\\sandbox\\tmp",
      TMP: "C:\\sandbox\\tmp",
      TEMP: "C:\\sandbox\\tmp",
    });
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it("loads trusted execution config and applies a per-run sandbox override", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-execution-config-"));
    directories.push(root);
    await writeFile(
      join(root, "execution.json"),
      JSON.stringify({
        mode: "off",
        network: "allow",
        environment: { allow: ["CUSTOM_FLAG"], set: { CI: "true" } },
      }),
    );
    expect(await loadExecutionConfig(root, "required")).toEqual({
      mode: "required",
      network: "allow",
      environment: { allow: ["CUSTOM_FLAG"], set: { CI: "true" } },
    });
    await expect(loadExecutionConfig(join(root, "missing"), "auto")).resolves.toMatchObject({
      mode: "auto",
      network: "deny",
    });
  });

  it("keeps direct execution environment isolation and preserves literal commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-direct-execution-"));
    directories.push(root);
    vi.stubEnv("FIDOO_TEST_SECRET", "do-not-inherit");
    const executor = new CommandExecutor(
      { mode: "off", network: "allow", environment: { allow: [], set: {} } },
      root,
    );
    const prepared = await executor.prepare({
      runId: "direct-run",
      command: "node",
      args: ["-e", "process.stdout.write('literal')"],
      cwd: root,
    });
    expect(prepared.command).toBe("node");
    expect(prepared.args).toEqual(["-e", "process.stdout.write('literal')"]);
    expect(prepared.env.FIDOO_TEST_SECRET).toBeUndefined();
    expect(prepared.env.HOME).not.toBe(process.env.HOME);
  });

  it("does not advertise a sandbox backend on native Windows", async () => {
    await expect(detectSandboxInstallation("win32")).resolves.toBeUndefined();
  });

  it("generates a network-isolated Bubblewrap command with read-only system mounts", () => {
    const prepared = bubblewrapCommand({
      executable: "/usr/bin/bwrap",
      workspace: "/workspace",
      runRoot: "/sandbox/run",
      cwd: "/workspace",
      readPaths: ["/usr", "/opt/node"],
      network: "deny",
      env: { PATH: "/usr/bin", HOME: "/sandbox/run/home" },
      command: "node",
      args: ["--test"],
    });
    expect(prepared.command).toBe("/usr/bin/bwrap");
    expect(prepared.args).toContain("--unshare-net");
    expect(prepared.args).toEqual(
      expect.arrayContaining(["--ro-bind", "/usr", "/usr", "--bind", "/workspace", "/workspace"]),
    );
    expect(prepared.args).not.toContain("FIDOO_API_KEY");
  });

  const seatbeltIt = process.platform === "darwin" ? it : it.skip;

  seatbeltIt(
    "enforces workspace writes, outside-read denial and secret isolation with Seatbelt",
    async () => {
      expect(await detectSandboxInstallation()).toMatchObject({ backend: "seatbelt" });
      const root = await mkdtemp(join(tmpdir(), "fidoo-seatbelt-"));
      directories.push(root);
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      const outside = join(root, "outside-secret.txt");
      await writeFile(outside, "outside-secret");
      await writeFile(
        join(workspace, "check.mjs"),
        `import { readFileSync, writeFileSync } from "node:fs";
writeFileSync(new URL("./sandbox-write.txt", import.meta.url), "allowed");
console.log(JSON.stringify({ secret: process.env.FIDOO_TEST_SECRET ?? null, home: process.env.HOME }));
try {
  readFileSync(process.argv[2], "utf8");
  console.log("outside read allowed");
} catch {
  console.log("outside read blocked");
}
`,
      );
      vi.stubEnv("FIDOO_TEST_SECRET", "do-not-inherit");
      const executor = new CommandExecutor(
        { mode: "required", network: "deny", environment: { allow: [], set: {} } },
        join(root, "runtime"),
      );
      const result = await executeTool(
        createBashTool(undefined, [], executor),
        { command: process.execPath, args: ["check.mjs", outside] },
        { cwd: workspace, runId: "seatbelt-read" },
      );
      expect(result.content).toContain("outside read blocked");
      expect(result.success).toBe(true);
      expect(result.content).toContain('"backend":"seatbelt"');
      expect(result.content).toContain('"secret":null');
      expect(result.content).not.toContain("do-not-inherit");
      expect(result.content).not.toContain("outside read allowed");
      await expect(readFile(join(workspace, "sandbox-write.txt"), "utf8")).resolves.toBe("allowed");
    },
  );

  seatbeltIt("runs a real package manager inside the sandbox", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-seatbelt-pnpm-"));
    directories.push(root);
    const executor = new CommandExecutor(
      { mode: "required", network: "deny", environment: { allow: [], set: {} } },
      join(root, "runtime"),
    );
    const result = await executeTool(
      createBashTool(undefined, [], executor),
      { command: "pnpm", args: ["--version"] },
      { cwd: root, runId: "seatbelt-pnpm" },
    );
    expect(result.content).toMatch(/\d+\.\d+\.\d+/);
    expect(result.success).toBe(true);
    expect(result.execution).toMatchObject({ backend: "seatbelt", network: "deny" });
  });

  seatbeltIt("denies network access and applies the same sandbox to background tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-seatbelt-network-"));
    directories.push(root);
    const server = createServer((_request, response) => response.end("reachable"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const executor = new CommandExecutor(
      { mode: "required", network: "deny", environment: { allow: [], set: {} } },
      join(root, "runtime"),
    );
    const tasks = new BackgroundTaskManager(join(root, "tasks"), executor);
    managers.push(tasks);
    try {
      const result = await executeTool(
        createBashTool(tasks, [], executor),
        {
          command: process.execPath,
          args: [
            "-e",
            `fetch("http://127.0.0.1:${address.port}").then(() => console.log("network allowed")).catch(() => console.log("network blocked"))`,
          ],
          background: true,
        },
        { cwd: root, runId: "seatbelt-network" },
      );
      expect(result.content).toContain('"backend":"seatbelt"');
      const task = (await tasks.list("seatbelt-network"))[0];
      if (!task) throw new Error("Missing background task");
      await vi.waitFor(async () => {
        expect((await tasks.readOutput(task.taskId)).content).toContain("network blocked");
      });
      expect((await tasks.readOutput(task.taskId)).content).not.toContain("network allowed");
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    }
  });
});
