import { homedir } from "node:os";
import { join } from "node:path";
import { defaultServerArguments } from "@fidoo/client/stdio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataHome, resolveRuntimeConfig, serverArguments } from "../../apps/cli/src/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider configuration", () => {
  it("uses DeepSeek defaults and its dedicated credentials", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://deepseek.test");
    const config = resolveRuntimeConfig({
      cwd: ".",
      provider: "deepseek",
      output: "json",
      maxIterations: "40",
    });
    expect(config).toMatchObject({
      provider: "deepseek",
      model: "deepseek-flash",
      apiKey: "deepseek-test-key",
      baseURL: "https://deepseek.test",
      thinking: "enabled",
    });
  });

  it("only forwards thinking to a DeepSeek sidecar", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-test-key");
    const openai = resolveRuntimeConfig({
      cwd: ".",
      provider: "openai",
      model: "test-model",
      output: "text",
      maxIterations: "40",
    });
    const deepseek = resolveRuntimeConfig({
      cwd: ".",
      provider: "deepseek",
      output: "text",
      maxIterations: "40",
    });
    expect(serverArguments(openai)).not.toContain("--thinking");
    expect(serverArguments(deepseek)).toContain("--thinking");
    const launch = defaultServerArguments(serverArguments(openai));
    expect(launch[0]).toContain("apps/agent-server/dist/index.js");
    expect(launch.slice(1)).toEqual(["--stdio", ...serverArguments(openai)]);
  });

  it("uses Fidoo credentials, endpoint and data home", () => {
    vi.stubEnv("FIDOO_API_KEY", "fidoo-test-key");
    vi.stubEnv("FIDOO_MODEL", "fidoo-model");
    vi.stubEnv("FIDOO_BASE_URL", "https://fidoo.test");
    vi.stubEnv("FIDOO_HOME", "/tmp/fidoo-home");
    const config = resolveRuntimeConfig({
      cwd: ".",
      output: "text",
      maxIterations: "40",
    });
    expect(config).toMatchObject({
      model: "fidoo-model",
      apiKey: "fidoo-test-key",
      baseURL: "https://fidoo.test",
      dataHome: "/tmp/fidoo-home",
    });
    vi.stubEnv("FIDOO_HOME", undefined);
    expect(dataHome()).toBe(join(homedir(), ".fidoo"));
  });

  it("rejects DeepSeek thinking options for the generic provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("FIDOO_MODEL", "test-model");
    expect(() =>
      resolveRuntimeConfig({
        cwd: ".",
        provider: "openai",
        thinking: "enabled",
        output: "text",
        maxIterations: "40",
      }),
    ).toThrow("only supported with --provider deepseek");
  });
});
