import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "@fidoo/core";
import type { RunCollection, RunStatus } from "@fidoo/observability";
import { isTerminalRunEvent } from "@fidoo/protocol";
import type { ObservabilitySource } from "./source.js";

const API_PREFIX = "/v1/observability";
const RUN_STATUSES = new Set(["running", "completed", "failed", "blocked", "cancelled"]);

export interface ObservabilityServerOptions {
  source: ObservabilitySource;
  webRoot?: string;
}

export function createObservabilityServer(options: ObservabilityServerOptions) {
  const webRoot = options.webRoot ?? fileURLToPath(new URL("../web/", import.meta.url));
  return createServer((request, response) => {
    void handle(request, response, options.source, webRoot).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const message = errorMessage(error);
      sendJson(response, message.includes("not found") ? 404 : 400, { error: message });
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  source: ObservabilitySource,
  webRoot: string,
): Promise<void> {
  setSecurityHeaders(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendJson(response, 405, { error: "Observability server is read-only" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith(API_PREFIX)) {
    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.end();
      return;
    }
    await serveStatic(url.pathname, response, webRoot);
    return;
  }
  const path = url.pathname.slice(API_PREFIX.length);
  if (path === "/runs") {
    const runs = await source.listRuns({
      ...runQuery(url),
      offset: integerParam(url, "offset", 0, 0, 10000),
      limit: integerParam(url, "limit", 50, 1, 200),
    });
    sendJson(response, 200, withSummary(runs));
    return;
  }
  const match = /^\/runs\/([A-Za-z0-9_-]+)(?:\/(events|stream|artifacts\/([a-f0-9]{8,64})))?$/.exec(
    path,
  );
  if (!match) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const runId = match[1] as string;
  const resource = match[2];
  if (!resource) {
    sendJson(response, 200, await source.getRun(runId));
  } else if (resource === "events") {
    sendJson(
      response,
      200,
      await source.getEvents(
        runId,
        integerParam(url, "afterSeq", 0, 0, Number.MAX_SAFE_INTEGER),
        integerParam(url, "limit", 200, 1, 1000),
      ),
    );
  } else if (resource === "stream") {
    await streamRun(request, response, source, runId, url);
  } else if (resource.startsWith("artifacts/")) {
    sendJson(
      response,
      200,
      await source.readArtifact(
        runId,
        match[3] as string,
        integerParam(url, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
        integerParam(url, "limit", 200, 1, 1000),
      ),
    );
  }
}

function runQuery(url: URL) {
  const status = url.searchParams.get("status");
  if (status && !RUN_STATUSES.has(status)) {
    throw new Error("Invalid run status");
  }
  return {
    ...(status ? { status: status as RunStatus } : {}),
    ...(url.searchParams.get("q") ? { q: url.searchParams.get("q") as string } : {}),
  };
}

function withSummary(collection: RunCollection) {
  const summary = {
    active: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    failedTools: 0,
  };
  for (const run of collection.items) {
    if (run.status === "running" || run.status === "awaiting_plan") summary.active += 1;
    else summary[run.status] += 1;
    summary.inputTokens += run.metrics.inputTokens;
    summary.outputTokens += run.metrics.outputTokens;
    summary.toolCalls += run.metrics.toolCalls;
    summary.failedTools += run.metrics.failedTools;
  }
  return { ...collection, summary };
}

async function streamRun(
  request: IncomingMessage,
  response: ServerResponse,
  source: ObservabilitySource,
  runId: string,
  url: URL,
): Promise<void> {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 2000\n\n");
  const lastEventId = request.headers["last-event-id"];
  const headerSeq = typeof lastEventId === "string" ? Number(lastEventId.split(":").at(-1)) : 0;
  let lastSeq = integerParam(
    url,
    "afterSeq",
    Number.isSafeInteger(headerSeq) ? headerSeq : 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  let polling = false;
  let closed = false;
  const poll = async () => {
    if (polling || closed) return;
    polling = true;
    try {
      const page = await source.getEvents(runId, lastSeq, 1000);
      for (const event of page.items) {
        response.write(
          `id: ${runId}:${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        lastSeq = event.seq;
      }
      if (page.items.some(isTerminalRunEvent)) {
        cleanup();
        response.end();
      }
    } catch {
      if (!closed) response.write(`event: stream.error\ndata: ${JSON.stringify({ lastSeq })}\n\n`);
    } finally {
      polling = false;
    }
  };
  const interval = setInterval(() => void poll(), 750);
  const heartbeat = setInterval(() => {
    if (!closed) response.write(": heartbeat\n\n");
  }, 15000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  };
  request.once("close", cleanup);
  await poll();
}

function integerParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function serveStatic(
  pathname: string,
  response: ServerResponse,
  webRoot: string,
): Promise<void> {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" || !extname(decoded) ? "/index.html" : decoded;
  const path = resolve(webRoot, `.${requested}`);
  if (path !== resolve(webRoot) && !path.startsWith(`${resolve(webRoot)}${sep}`)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentType(extname(path)),
      "Content-Length": metadata.size,
      "Cache-Control": path.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });
    createReadStream(path).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Web build not found; run pnpm build" });
  }
}

function contentType(extension: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return types[extension] ?? "application/octet-stream";
}
