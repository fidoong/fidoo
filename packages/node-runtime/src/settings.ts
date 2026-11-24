import { AgentError } from "@fidoo/core";
import {
  normalizeProviderBaseURL,
  type ProviderModelsParams,
  type ProviderSettings,
  providerDefinition,
  type SettingsUpdateParams,
  settingsUpdateParamsSchema,
} from "@fidoo/protocol";
import { BackgroundTaskManager } from "./adapters/tasks/background-task-manager.js";
import { createNodeRuntime, type NodeRuntime } from "./composition-root.js";
import type { NodeRuntimeConfig } from "./config.js";
import { toProviderSettings, writeProviderConnection } from "./model-config.js";
import { discoverProviderModels } from "./model-discovery.js";

export interface SettingsUpdateResult {
  settings: ProviderSettings;
  createRunService: NodeRuntime["createRunService"];
}

export class NodeSettingsManager {
  constructor(
    private config: NodeRuntimeConfig,
    private readonly tasks = new BackgroundTaskManager(config.dataHome),
  ) {}

  getSettings(): ProviderSettings {
    return toProviderSettings(this.config);
  }

  listModels(input: ProviderModelsParams): Promise<{ models: string[]; unavailable?: boolean }> {
    const savedApiKey = input.provider === this.config.provider ? this.config.apiKey : "";
    return discoverProviderModels(input, savedApiKey);
  }

  async updateSettings(input: SettingsUpdateParams): Promise<SettingsUpdateResult> {
    const update = settingsUpdateParamsSchema.parse(input);
    const definition = providerDefinition(update.provider);
    const model = update.model.trim();
    const baseURL = normalizeProviderBaseURL(update.provider, update.baseURL);
    const apiKey =
      update.apiKey?.trim() || (update.provider === this.config.provider ? this.config.apiKey : "");
    if (!model) throw new AgentError("Model is required", "configuration");
    if (!baseURL || !validUrl(baseURL)) {
      throw new AgentError("A valid HTTP(S) Base URL is required", "configuration");
    }
    if (definition.apiKeyRequired && !apiKey) {
      throw new AgentError(`API key is required for ${definition.name}`, "configuration");
    }
    const next: NodeRuntimeConfig = {
      ...this.config,
      provider: update.provider,
      model,
      baseURL,
      apiKey,
      thinking: update.thinking ?? this.config.thinking,
    };
    const runtime = await createNodeRuntime(next, undefined, undefined, this.tasks);
    if (update.save) await writeProviderConnection(next);
    this.config = next;
    return { settings: toProviderSettings(next), createRunService: runtime.createRunService };
  }
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
