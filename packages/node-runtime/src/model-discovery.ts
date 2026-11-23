import { AgentError } from "@fidoo/core";
import {
  normalizeProviderBaseURL,
  type ProviderModelsParams,
  providerDefinition,
  providerModelsParamsSchema,
} from "@fidoo/protocol";
import { openProviderStream } from "./adapters/models/http.js";

export async function discoverProviderModels(
  input: ProviderModelsParams,
  savedApiKey = "",
): Promise<{ models: string[]; unavailable?: boolean }> {
  const params = providerModelsParamsSchema.parse(input);
  const definition = providerDefinition(params.provider);
  const baseURL = normalizeProviderBaseURL(params.provider, params.baseURL);
  if (!validUrl(baseURL)) {
    throw new AgentError("A valid HTTP(S) Base URL is required", "configuration");
  }
  const apiKey = params.apiKey?.trim() || savedApiKey;
  if (definition.apiKeyRequired && !apiKey) {
    throw new AgentError(`API key is required for ${definition.name}`, "configuration");
  }
  const path =
    definition.protocol === "anthropic"
      ? "/v1/models"
      : definition.protocol === "gemini"
        ? "/v1beta/models"
        : "/models";
  const headers: Record<string, string> =
    definition.protocol === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : definition.protocol === "gemini"
        ? { "x-goog-api-key": apiKey }
        : apiKey
          ? { authorization: `Bearer ${apiKey}` }
          : {};
  let response: Response;
  try {
    response = await openProviderStream(
      `${baseURL}${path}`,
      { method: "GET", headers },
      AbortSignal.timeout(15_000),
    );
  } catch (error) {
    if (error instanceof AgentError && error.message.includes("HTTP 404")) {
      return { models: [], unavailable: true };
    }
    throw error;
  }
  const body: unknown = await response.json();
  const models = parseModelIds(body, definition.protocol);
  if (models.length === 0) {
    return { models: [], unavailable: true };
  }
  return { models };
}

function parseModelIds(value: unknown, protocol: "openai" | "anthropic" | "gemini"): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries =
    (value as Record<string, unknown>).data ?? (value as Record<string, unknown>).models;
  if (!Array.isArray(entries)) return [];
  const ids = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
    const record = entry as Record<string, unknown>;
    const id = record.id ?? record.name;
    if (typeof id !== "string") return "";
    return protocol === "gemini" ? id.replace(/^models\//, "") : id;
  });
  return [...new Set(ids.filter(Boolean))].slice(0, 200);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
