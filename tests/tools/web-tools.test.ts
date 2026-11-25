import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { createWebSearch, createWebTools, fetchWebPage } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../helpers/tool.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

describe("web tools", () => {
  it("uses the Tavily adapter without embedding the key in results", async () => {
    const requests: { authorization?: string; body: string }[] = [];
    const baseURL = await mockServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        requests.push({
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {}),
          body,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            results: [
              {
                title: "TypeScript",
                url: "https://typescriptlang.org",
                content: "Official documentation",
              },
            ],
          }),
        );
      });
    });
    const search = createWebSearch({ provider: "tavily", baseURL, apiKey: "test-key" });
    const page = await search.search({
      query: "TypeScript docs",
      limit: 3,
      signal: new AbortController().signal,
    });
    expect(page.results).toMatchObject([
      { title: "TypeScript", snippet: "Official documentation" },
    ]);
    expect(requests[0]?.authorization).toBe("Bearer test-key");
    expect(requests[0]?.body).toContain('"max_results":3');
    expect(JSON.stringify(page)).not.toContain("test-key");
  });

  it("supports SearXNG without an API key", async () => {
    const baseURL = await mockServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      expect(url.searchParams.get("format")).toBe("json");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          results: [{ title: "Result", url: "https://example.com", content: "Snippet" }],
        }),
      );
    });
    const page = await createWebSearch({ provider: "searxng", baseURL }).search({
      query: "open source",
      limit: 2,
      signal: new AbortController().signal,
    });
    expect(page).toMatchObject({ provider: "searxng", results: [{ title: "Result" }] });
  });

  it("maps Brave's nested web results", async () => {
    const baseURL = await mockServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          web: {
            results: [
              { title: "Brave result", url: "https://example.com", description: "Description" },
            ],
          },
        }),
      );
    });
    const page = await createWebSearch({ provider: "brave", baseURL, apiKey: "brave-key" }).search({
      query: "test",
      limit: 1,
      signal: new AbortController().signal,
    });
    expect(page.results[0]?.snippet).toBe("Description");
  });

  it("fetches bounded text but blocks private targets in the Agent tool", async () => {
    const baseURL = await mockServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<html><title>Example</title><script>bad()</script><p>Hello &amp; welcome</p></html>",
      );
    });
    const page = await fetchWebPage(
      { url: `${baseURL}/docs`, maxChars: 5000, signal: new AbortController().signal },
      true,
    );
    expect(page.title).toBe("Example");
    expect(page.content).toBe("Hello & welcome");
    const webFetch = createWebTools().find((tool) => tool.name === "web_fetch");
    if (!webFetch) throw new Error("Missing web_fetch");
    await expect(
      executeTool(webFetch, { url: `${baseURL}/docs` }, { cwd: process.cwd() }),
    ).rejects.toThrow("Private or local");
  });

  it("reports missing search configuration explicitly", async () => {
    const search = createWebTools().find((tool) => tool.name === "web_search");
    if (!search) throw new Error("Missing web_search");
    await expect(executeTool(search, { query: "test" }, { cwd: process.cwd() })).rejects.toThrow(
      "Web search is not configured",
    );
  });
});

async function mockServer(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
