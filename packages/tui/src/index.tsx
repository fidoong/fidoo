import type { AgentClient } from "@fidoo/client";
import { render } from "ink";
import { AgentController } from "./agent-controller.js";
import { TuiApp, type TuiAppOptions } from "./app.js";
import { applyTheme } from "./theme.js";

export interface RenderTuiOptions extends TuiAppOptions {
  client: AgentClient;
}

export function renderTui({ client, ...options }: RenderTuiOptions) {
  applyTheme(options.theme);
  const controller = new AgentController(client, options.cwd);
  const app = render(<TuiApp controller={controller} options={options} />, {
    exitOnCtrlC: false,
    incrementalRendering: false,
    maxFps: 20,
  });
  return { ...app, controller };
}

export { AgentController } from "./agent-controller.js";
export { TuiApp } from "./app.js";
export { createPlanSteps } from "./plan.js";
export { applyRunEvent, initialTuiState } from "./store.js";
export type { ThemeColors, ThemePreference, ThemePresetId } from "./theme.js";
export {
  applyTheme,
  DEFAULT_THEME,
  parseThemePreference,
  resolveTheme,
  THEME_PRESET_IDS,
  THEME_PRESETS,
} from "./theme.js";
export type { TuiState } from "./types.js";
