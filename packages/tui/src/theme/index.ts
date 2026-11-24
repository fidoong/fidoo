import type { TuiPhase } from "../runtime/types.js";

export interface ThemeColors {
  brand: string;
  brandSecondary: string;
  accent: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  error: string;
  code: string;
  border: string;
  surface: string;
}

export type ThemePresetId = "next" | "graphite" | "midnight" | "light";

export interface ThemePreference {
  preset: ThemePresetId;
  colors?: Partial<ThemeColors>;
}

export const THEME_PRESETS: Record<
  ThemePresetId,
  { name: string; description: string; colors: ThemeColors }
> = {
  next: {
    name: "Next",
    description: "Monochrome surfaces with Next blue interactions",
    colors: {
      brand: "#fafafa",
      brandSecondary: "#a3a3a3",
      accent: "#0070f3",
      text: "#fafafa",
      muted: "#8a8a8a",
      success: "#46a758",
      warning: "#f5a524",
      error: "#f31260",
      code: "#fafafa",
      border: "#3b3b3b",
      surface: "#171717",
    },
  },
  graphite: {
    name: "Graphite",
    description: "Pure grayscale with no chromatic interface accents",
    colors: {
      brand: "#ffffff",
      brandSecondary: "#a3a3a3",
      accent: "#d4d4d4",
      text: "#f5f5f5",
      muted: "#8a8a8a",
      success: "#d4d4d4",
      warning: "#f5f5f5",
      error: "#ffffff",
      code: "#ffffff",
      border: "#404040",
      surface: "#171717",
    },
  },
  midnight: {
    name: "Midnight",
    description: "Cool editor colors inspired by dark code surfaces",
    colors: {
      brand: "#e6edf3",
      brandSecondary: "#8b949e",
      accent: "#58a6ff",
      text: "#e6edf3",
      muted: "#8b949e",
      success: "#3fb950",
      warning: "#d29922",
      error: "#f85149",
      code: "#e6edf3",
      border: "#30363d",
      surface: "#0d1117",
    },
  },
  light: {
    name: "Light",
    description: "High-contrast dark ink for light terminal backgrounds",
    colors: {
      brand: "#171717",
      brandSecondary: "#525252",
      accent: "#0070f3",
      text: "#171717",
      muted: "#525252",
      success: "#18794e",
      warning: "#946200",
      error: "#c00c4d",
      code: "#171717",
      border: "#d4d4d4",
      surface: "#f5f5f5",
    },
  },
};

export const THEME_PRESET_IDS = ["next", "graphite", "midnight", "light"] as const;

export const DEFAULT_THEME: ThemePreference = { preset: "next" };

export const theme: ThemeColors = { ...THEME_PRESETS.next.colors };

export function resolveTheme(preference: ThemePreference = DEFAULT_THEME): ThemeColors {
  return { ...THEME_PRESETS[preference.preset].colors, ...preference.colors };
}

export function applyTheme(preference: ThemePreference = DEFAULT_THEME): ThemeColors {
  return Object.assign(theme, resolveTheme(preference));
}

export function parseThemePreference(value: unknown): ThemePreference {
  if (value === undefined) {
    return DEFAULT_THEME;
  }
  if (!value || typeof value !== "object") {
    throw new Error("Theme config must be a JSON object");
  }
  const input = value as { preset?: unknown; colors?: unknown };
  const preset = input.preset ?? "next";
  if (typeof preset !== "string" || !(preset in THEME_PRESETS)) {
    throw new Error(`Unknown theme preset: ${String(preset)}`);
  }
  const preference: ThemePreference = { preset: preset as ThemePresetId };
  if (input.colors !== undefined) {
    if (!input.colors || typeof input.colors !== "object" || Array.isArray(input.colors)) {
      throw new Error("Theme colors must be a JSON object");
    }
    const colors: Partial<ThemeColors> = {};
    for (const [key, color] of Object.entries(input.colors)) {
      if (!(key in THEME_PRESETS.next.colors) || typeof color !== "string" || !color.trim()) {
        throw new Error(`Invalid theme color: ${key}`);
      }
      Object.assign(colors, { [key]: color });
    }
    preference.colors = colors;
  }
  return preference;
}

export function statusColor(phase: TuiPhase): string {
  if (phase === "completed") {
    return theme.success;
  }
  if (phase === "failed") {
    return theme.error;
  }
  if (phase === "awaiting_approval" || phase === "blocked") {
    return theme.warning;
  }
  if (phase === "starting" || phase === "running") {
    return theme.accent;
  }
  return theme.muted;
}
