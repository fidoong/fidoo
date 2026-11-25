import { AgentError, type WebSearchPort, type WebSearchResult } from "@fidoo/core";
import type { WebSearchConfig } from "./config.js";

export function createWebSearch(config: WebSearchConfig): WebSearchPort {
  return {
    async search({ query, limit, signal }) {
      const response = await searchRequest(config, query, limit, signal);
      const body = (await response.json()) as unknown;
      const results = searchResults(config.provider, body)
        .filter((result) => /^https?:\/\//.test(result.url))
        .slice(0, limit);
      return { query, provider: config.provider, results };
    },
  };
}

async function searchRequest(
  config: WebSearchConfig,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(20_000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  let response: Response;
  if (config.provider === "tavily") {
    if (!config.apiKey)
      throw new AgentError("FIDOO_SEARCH_API_KEY is required for Tavily", "configuration");
    response = await fetch(
      `${(config.baseURL ?? "https://api.tavily.com").replace(/\/$/, "")}/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ query, max_results: limit, include_answer: false }),
        signal: requestSignal,
      },
    );
  } else if (config.provider === "brave") {
    if (!config.apiKey)
      throw new AgentError("FIDOO_SEARCH_API_KEY is required for Brave", "configuration");
    const url = new URL(config.baseURL ?? "https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    response = await fetch(url, {
      headers: { accept: "application/json", "x-subscription-token": config.apiKey },
      signal: requestSignal,
    });
  } else {
    if (!config.baseURL) throw new AgentError("SearXNG requires search.baseURL", "configuration");
    const url = new URL("/search", config.baseURL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    response = await fetch(url, { headers: { accept: "application/json" }, signal: requestSignal });
  }
  if (!response.ok) {
    throw new AgentError(`Web search failed with HTTP ${response.status}`, "tool", true);
  }
  return response;
}

function searchResults(provider: WebSearchConfig["provider"], body: unknown): WebSearchResult[] {
  const root = record(body);
  const candidates = provider === "brave" ? record(root?.web)?.results : root?.results;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((value) => {
    const item = record(value);
    const title = text(item?.title);
    const url = text(item?.url);
    const snippet = text(item?.content) ?? text(item?.description) ?? text(item?.snippet) ?? "";
    return title && url ? [{ title, url, snippet }] : [];
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
