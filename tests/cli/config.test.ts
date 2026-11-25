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
    vi.stubEnv("FIDOO_API_KEY", undefined);
    vi.stubEnv("FIDOO_MODEL", undefined);
    vi.stubEnv("FIDOO_BASE_URL", undefined);
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

  it("forwards an explicit permission policy to the runtime and sidecar", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const config = resolveRuntimeConfig({
      cwd: ".",
      provider: "openai",
      model: "test-model",
      policy: "./company-policy.json",
      output: "text",
      maxIterations: "40",
    });
    expect(config.policyFile).toBe("./company-policy.json");
    expect(serverArguments(config)).toEqual(
      expect.arrayContaining(["--policy", "./company-policy.json"]),
    );
  });

  it("forwards the selected sandbox mode to the sidecar", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const config = resolveRuntimeConfig({
      cwd: ".",
      provider: "openai",
      model: "test-model",
      sandbox: "required",
      output: "text",
      maxIterations: "40",
    });
    expect(config.sandbox).toBe("required");
    expect(serverArguments(config)).toEqual(expect.arrayContaining(["--sandbox", "required"]));
  });

  it("forwards the agent behavior mode and rejects read-only auto", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const config = resolveRuntimeConfig({
      cwd: ".",
      provider: "openai",
      model: "test-model",
      mode: "acceptEdits",
      output: "text",
      maxIterations: "40",
    });
    expect(config.mode).toBe("acceptEdits");
    expect(serverArguments(config)).toEqual(expect.arrayContaining(["--mode", "acceptEdits"]));
    expect(() =>
      resolveRuntimeConfig({
        cwd: ".",
        provider: "openai",
        model: "test-model",
        mode: "auto",
        readOnly: true,
        output: "text",
        maxIterations: "40",
      }),
    ).toThrow("--read-only cannot be combined");
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
