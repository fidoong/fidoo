import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../../packages/tui/src/components/settings-dialog.js";

describe("SettingsDialog", () => {
  it("discovers live models after connection setup and saves the selected model", async () => {
    const saved: unknown[] = [];
    const discoveries: unknown[] = [];
    const view = render(
      <SettingsDialog
        initial={{
          provider: "openai",
          model: "",
          baseURL: "https://api.openai.com/v1",
          hasApiKey: false,
          configured: false,
          contextLimit: 100_000,
          thinking: "enabled",
        }}
        onSave={async (settings) => {
          saved.push(settings);
        }}
        onDiscover={async (params) => {
          discoveries.push(params);
          return { models: ["latest-model", "other-model"] };
        }}
      />,
    );
    try {
      expect(view.lastFrame()).toContain("Model setup");
      expect(view.lastFrame()).toContain("Anthropic Claude");
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("provider endpoint"));
      view.stdin.write("\u0015");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("› ▌"));
      view.stdin.write("https://provider.test");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("https://provider.test"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("API key required"));
      view.stdin.write("secret-key");
      expect(view.lastFrame()).not.toContain("secret-key");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("••••••••••"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("Live catalog · 2 models"));
      view.stdin.write("\t");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("› latest-model▌"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(view.lastFrame()).toContain("new key entered"));
      view.stdin.write("\r");
      await vi.waitFor(() => expect(saved).toHaveLength(1));
      expect(discoveries[0]).toMatchObject({
        provider: "openai",
        baseURL: "https://provider.test",
        apiKey: "secret-key",
      });
      expect(saved[0]).toMatchObject({
        provider: "openai",
        model: "latest-model",
        baseURL: "https://provider.test",
        apiKey: "secret-key",
        save: true,
      });
    } finally {
      view.unmount();
    }
  });
});
