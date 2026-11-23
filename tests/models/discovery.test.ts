import { discoverProviderModels } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("provider model discovery", () => {
  it("uses the native Anthropic model endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-future" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      discoverProviderModels({
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        apiKey: "test-key",
      }),
    ).resolves.toEqual({ models: ["claude-future"] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/models");
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("normalizes Kimi Coding /coding/v1 and tolerates an unavailable model catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      discoverProviderModels({
        provider: "kimi-code",
        baseURL: "https://api.kimi.com/coding",
        apiKey: "test-key",
      }),
    ).resolves.toEqual({ models: [], unavailable: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.kimi.com/coding/v1/models");
  });

  it("normalizes Gemini resource names from the native catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-future" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      discoverProviderModels({
        provider: "gemini",
        baseURL: "https://generativelanguage.googleapis.com",
        apiKey: "test-key",
      }),
    ).resolves.toEqual({ models: ["gemini-future"] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
  });
});
