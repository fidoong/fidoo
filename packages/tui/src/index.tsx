import type { AgentClient } from "@fidoo/client";
import { render } from "ink";

export { render as renderInk } from "ink";

import { TuiApp, type TuiAppOptions } from "./app.js";
import { AgentController } from "./runtime/agent-controller.js";
import { applyTheme } from "./theme/index.js";

export interface RenderTuiOptions extends TuiAppOptions {
  client: AgentClient;
}

export function renderTui({ client, ...options }: RenderTuiOptions) {
  applyTheme(options.theme);
  const controller = new AgentController(client, options.cwd);
  const app = render(<TuiApp controller={controller} options={options} />, {
    exitOnCtrlC: false,
    incrementalRendering: true,
    maxFps: 20,
  });
  return { ...app, controller };
}

export { TuiApp } from "./app.js";
export type { ActivityState } from "./runtime/activity-controller.js";
export { ActivityController } from "./runtime/activity-controller.js";
export { AgentController } from "./runtime/agent-controller.js";
export { ComposerStore } from "./runtime/composer-store.js";
export { createPlanSteps } from "./runtime/plan.js";
export { applyRunEvent, initialTuiState } from "./runtime/store.js";
export type { TuiState } from "./runtime/types.js";
export type { ThemeColors, ThemePreference, ThemePresetId } from "./theme/index.js";
export {
  applyTheme,
  DEFAULT_THEME,
  parseThemePreference,
  resolveTheme,
  THEME_PRESET_IDS,
  THEME_PRESETS,
} from "./theme/index.js";
