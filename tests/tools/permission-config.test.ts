import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine, ToolRegistry } from "@fidoo/core";
import { createCodingTools, loadPermissionPolicy } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("permission config files", () => {
  it("merges global, project and explicit files in precedence order", async () => {
    const root = await workspace();
    const cwd = join(root, "workspace");
    const dataHome = join(root, "home");
    await mkdir(cwd);
    await mkdir(dataHome);
    await writeJson(join(dataHome, "policy.json"), {
      version: 1,
      mode: "auto",
      rules: [{ action: "allow", tools: ["bash"], commands: ["git *"] }],
    });
    await writeJson(join(cwd, "fidoo.policy.json"), {
      version: 1,
      rules: [{ action: "deny", tools: ["bash"], commands: ["git *"] }],
    });
    const explicit = join(root, "trusted.json");
    await writeJson(explicit, {
      version: 1,
      rules: [{ action: "allow", tools: ["bash"], commands: ["git status"] }],
    });

    const loaded = await loadPermissionPolicy({ cwd, dataHome, policyFile: explicit });
    expect(loaded.mode).toBe("auto");
    expect(loaded.sources).toEqual([
      join(dataHome, "policy.json"),
      join(cwd, "fidoo.policy.json"),
      explicit,
    ]);
    expect(loaded.rules.map((rule) => rule.action)).toEqual(["allow", "deny", "allow"]);

    const bash = new ToolRegistry(createCodingTools()).get("bash");
    if (!bash) throw new Error("Missing bash");
    const engine = new PolicyEngine(loaded.mode ?? "manual", loaded.rules);
    expect(engine.evaluate(bash, { command: "git", args: ["status"] }).action).toBe("allow");
    expect(engine.evaluate(bash, { command: "git", args: ["push"] }).action).toBe("deny");
  });

  it("rejects project policies that attempt to elevate permissions", async () => {
    const root = await workspace();
    await writeJson(join(root, "fidoo.policy.json"), {
      version: 1,
      rules: [{ action: "allow", tools: ["bash"], commands: ["*"] }],
    });
    await expect(loadPermissionPolicy({ cwd: root, dataHome: join(root, "home") })).rejects.toThrow(
      "Project policies can only restrict access",
    );
  });

  it("rejects project policies that enable automatic edit approval", async () => {
    const root = await workspace();
    await writeJson(join(root, "fidoo.policy.json"), {
      version: 1,
      mode: "acceptEdits",
      rules: [],
    });
    await expect(loadPermissionPolicy({ cwd: root, dataHome: join(root, "home") })).rejects.toThrow(
      "Project policies can only restrict access",
    );
  });

  it("deduplicates a file explicitly selected at its default global path", async () => {
    const root = await workspace();
    const path = join(root, "policy.json");
    await writeJson(path, {
      version: 1,
      rules: [{ action: "deny", tools: ["bash"], commands: ["git push*"] }],
    });
    const loaded = await loadPermissionPolicy({ cwd: root, dataHome: root, policyFile: path });
    expect(loaded.sources).toEqual([path]);
    expect(loaded.rules).toHaveLength(1);
  });

  it("fails clearly when an explicit policy is missing or malformed", async () => {
    const root = await workspace();
    await expect(
      loadPermissionPolicy({ cwd: root, dataHome: root, policyFile: "missing.json" }),
    ).rejects.toThrow("Cannot read permission config");
    await writeJson(join(root, "fidoo.policy.json"), {
      version: 1,
      rules: [{ action: "deny" }],
    });
    await expect(loadPermissionPolicy({ cwd: root, dataHome: root })).rejects.toThrow(
      "at least one selector",
    );
  });
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "fidoo-permission-config-"));
  directories.push(path);
  return path;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), "utf8");
}
