import {
  applyTheme,
  DEFAULT_THEME,
  parseThemePreference,
  resolveTheme,
  THEME_PRESETS,
} from "@fidoo/tui";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  applyTheme(DEFAULT_THEME);
});

describe("TUI theme system", () => {
  it("resolves presets and custom color overrides", () => {
    const preference = parseThemePreference({
      preset: "light",
      colors: { accent: "#123456", border: "#abcdef" },
    });
    const resolved = resolveTheme(preference);
    expect(resolved.accent).toBe("#123456");
    expect(resolved.border).toBe("#abcdef");
    expect(resolved.text).toBe(THEME_PRESETS.light.colors.text);
  });

  it("rejects unknown presets and invalid color values", () => {
    expect(() => parseThemePreference({ preset: "unknown" })).toThrow("Unknown theme preset");
    expect(() => parseThemePreference({ preset: "next", colors: { accent: 42 } })).toThrow(
      "Invalid theme color",
    );
    expect(() => parseThemePreference({ preset: "next", colors: { unknown: "#fff" } })).toThrow(
      "Invalid theme color",
    );
  });
});
