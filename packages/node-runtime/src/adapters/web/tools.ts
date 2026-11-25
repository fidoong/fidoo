import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import { boundedOutput } from "../tools/output.js";
import type { WebSearchConfig } from "./config.js";
import { createWebSearch } from "./search.js";

export function createWebTools(config?: WebSearchConfig) {
  const search = config ? createWebSearch(config) : undefined;
  const searchTool = defineTool({
    name: "web_search",
    description:
      "Search the web through the configured Tavily, Brave or SearXNG adapter. Returns structured titles, URLs and snippets. Do not use it when local project evidence is sufficient.",
    inputSchema: z.object({
      query: z.string().min(1).max(2000),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    effect: "network",
    risk: "medium",
    concurrency: "safe",
    idempotency: "always",
    execute: async (input, context) => {
      if (!search) {
        throw new AgentError(
          "Web search is not configured. Set FIDOO_SEARCH_API_KEY or configure SearXNG in .fidoo.json",
          "configuration",
        );
      }
      const page = await search.search({
        query: input.query,
        limit: input.limit,
        signal: context.signal,
      });
      return {
        summary: `Found ${page.results.length} web results for ${input.query}`,
        content: JSON.stringify(page, null, 2),
      };
    },
  });

  const fetchTool = defineTool({
    name: "web_fetch",
    description:
      "Fetch one selected public HTTP(S) URL after web_search. HTML is converted to bounded plain text. Private-network targets and non-text content are rejected by default.",
    inputSchema: z.object({
      url: z.string().url(),
      max_chars: z.number().int().min(1000).max(50_000).default(20_000),
    }),
    effect: "network",
    risk: "medium",
    concurrency: "safe",
    idempotency: "always",
    execute: async (input, context) => {
      const page = await fetchWebPage({
        url: input.url,
        maxChars: input.max_chars,
        signal: context.signal,
      });
      return {
        summary: `Fetched ${page.finalUrl}`,
        ...(await boundedOutput(context, "web-page.txt", JSON.stringify(page, null, 2), 48_000)),
      };
    },
  });
  return [searchTool, fetchTool];
}

export async function fetchWebPage(
  input: { url: string; maxChars: number; signal: AbortSignal },
  allowPrivate = false,
) {
  let current = new URL(input.url);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeTarget(current, allowPrivate);
    response = await fetch(current, {
      redirect: "manual",
      headers: { accept: "text/html,text/plain,application/json,application/xml" },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(20_000)]),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new AgentError("Redirect is missing Location", "tool");
      current = new URL(location, current);
      await response.body?.cancel();
      continue;
    }
    break;
  }
  if (!response) throw new AgentError("Web fetch did not return a response", "tool");
  if (!response.ok) throw new AgentError(`Web fetch failed with HTTP ${response.status}`, "tool");
  if (response.status >= 300) throw new AgentError("Too many redirects", "tool");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("text/") &&
    !contentType.includes("json") &&
    !contentType.includes("xml") &&
    !contentType.includes("xhtml")
  ) {
    throw new AgentError(`Unsupported web content type: ${contentType || "unknown"}`, "tool");
  }
  const source = await readLimited(response, 1024 * 1024);
  const html = contentType.includes("html") || contentType.includes("xhtml");
  const title = html ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1]?.trim() : undefined;
  const text = html ? htmlToText(source) : source;
  return {
    finalUrl: current.toString(),
    ...(title ? { title } : {}),
    contentType,
    content: text.slice(0, input.maxChars),
    truncated: text.length > input.maxChars,
  };
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AgentError("Web response exceeds the 1 MiB limit", "budget");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function assertSafeTarget(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentError("Only HTTP(S) URLs are allowed", "tool");
  }
  if (url.username || url.password) throw new AgentError("URL credentials are not allowed", "tool");
  if (allowPrivate) return;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new AgentError("Private or local web targets are not allowed", "tool");
  }
  const address = isIP(hostname) ? hostname : (await lookup(hostname)).address;
  if (privateIp(address))
    throw new AgentError("Private or local web targets are not allowed", "tool");
}

function privateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8")
    );
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function htmlToText(source: string): string {
  return decodeEntities(
    source
      .replace(/<(head|title|script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeEntities(source: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return source.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}
