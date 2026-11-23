import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentApi, InProcessTransport } from "@fidoo/api";
import { createAgentClient } from "@fidoo/client";
import {
  createNodeRuntime,
  NodeSettingsManager,
  readProviderConnection,
} from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("runtime model settings", () => {
  it("persists a 0600 config, preserves same-provider keys and never returns secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "fidoo-settings-"));
    directories.push(root);
    const config = {
      cwd: root,
      provider: "openai" as const,
      model: "gpt-4.1",
      apiKey: "super-secret-key",
      baseURL: "https://api.openai.com/v1",
      thinking: "enabled" as const,
      dataHome: root,
      autoApprove: false,
      readOnly: true,
      maxIterations: 10,
      maxContextTokens: 100_000,
    };
    const runtime = await createNodeRuntime(config);
    const settings = new NodeSettingsManager(config);
    const api = new AgentApi({
      createRunService: runtime.createRunService,
      eventStore: runtime.eventStore,
      artifacts: runtime.artifacts,
      workspace: runtime.workspace,
      settings,
    });
    const client = createAgentClient(new InProcessTransport(api));
    const initial = await client.settings.get();
    expect(initial).toMatchObject({ provider: "openai", configured: true, hasApiKey: true });
    expect(JSON.stringify(initial)).not.toContain("super-secret-key");

    const updated = await client.settings.update({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseURL: "https://api.openai.com/v1",
      save: true,
    });
    expect(updated).toMatchObject({ model: "gpt-4.1-mini", hasApiKey: true });
    const mode = (await stat(join(root, "models.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readProviderConnection(root)).toMatchObject({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "super-secret-key",
    });

    await expect(
      client.settings.update({
        provider: "anthropic",
        model: "claude-test",
        baseURL: "https://api.anthropic.com",
        save: false,
      }),
    ).rejects.toThrow("API key is required");
    const saved = await readFile(join(root, "models.json"), "utf8");
    expect(saved).toContain("gpt-4.1-mini");
    expect(saved).not.toContain("claude-test");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "future-model" }, { id: "gpt-4.1-mini" }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      client.settings.listModels({
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
      }),
    ).resolves.toEqual({ models: ["future-model", "gpt-4.1-mini"] });
  });
});
