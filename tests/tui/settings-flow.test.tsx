import { createAgentClient } from "@fidoo/client";
import type { AgentTransport, ApiMethod, ProviderSettings } from "@fidoo/protocol";
import { AgentController, TuiApp } from "@fidoo/tui";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

describe("TUI settings entry", () => {
  it("opens guided setup automatically when no provider is configured", async () => {
    const transport = new SettingsTransport(false);
    const view = renderSession(transport);
    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Model setup"));
      expect(view.lastFrame()).toContain("Provider · 1/5");
      expect(view.lastFrame()).toContain("Kimi / Moonshot");
    } finally {
      view.unmount();
    }
  });

  it("opens and closes settings through /settings after configuration", async () => {
    const transport = new SettingsTransport(true);
    const view = renderSession(transport);
    try {
      await vi.waitFor(() => expect(transport.calls).toContain("settings.get"));
      expect(view.lastFrame()).not.toContain("Model setup");
      view.stdin.write("/settings");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("/settings"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Model setup"));
      view.stdin.write("\u001b");
      await vi.waitFor(() => expect(view.lastFrame()).not.toContain("Model setup"));
    } finally {
      view.unmount();
    }
  });
});

function renderSession(transport: SettingsTransport) {
  const controller = new AgentController(createAgentClient(transport), "/workspace");
  return render(
    <TuiApp
      controller={controller}
      options={{ cwd: "/workspace", provider: "openai", model: "gpt-4.1" }}
      onExit={() => undefined}
    />,
  );
}

class SettingsTransport implements AgentTransport {
  readonly calls: ApiMethod[] = [];
  private settings: ProviderSettings;

  constructor(configured: boolean) {
    this.settings = {
      provider: "openai",
      model: configured ? "gpt-4.1" : "",
      baseURL: "https://api.openai.com/v1",
      hasApiKey: configured,
      configured,
      contextLimit: 100_000,
      thinking: "enabled",
    };
  }

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    this.calls.push(method);
    if (method === "settings.get") return this.settings;
    if (method === "settings.update") {
      const input = params as { model: string; baseURL: string };
      this.settings = {
        ...this.settings,
        model: input.model,
        baseURL: input.baseURL,
        hasApiKey: true,
        configured: true,
      };
      return this.settings;
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  subscribe(): AsyncIterable<unknown> {
    throw new Error("Subscriptions are not used in this test");
  }
}
