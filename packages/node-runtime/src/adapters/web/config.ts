import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentError } from "@fidoo/core";
import { z } from "zod";

const schema = z
  .object({
    search: z
      .strictObject({
        provider: z.enum(["tavily", "brave", "searxng"]),
        baseURL: z.string().url().optional(),
      })
      .optional(),
  })
  .passthrough();

export interface WebSearchConfig {
  provider: "tavily" | "brave" | "searxng";
  baseURL?: string;
  apiKey?: string;
}

export async function loadWebSearchConfig(cwd: string): Promise<WebSearchConfig | undefined> {
  let project: { provider: "tavily" | "brave" | "searxng"; baseURL?: string } | undefined;
  try {
    const source = await readFile(join(cwd, ".fidoo.json"), "utf8");
    const parsed = schema.parse(JSON.parse(source));
    project = parsed.search
      ? {
          provider: parsed.search.provider,
          ...(parsed.search.baseURL ? { baseURL: parsed.search.baseURL } : {}),
        }
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new AgentError(`Invalid web search configuration: ${error.message}`, "configuration");
      }
      throw error;
    }
  }
  const apiKey = process.env.FIDOO_SEARCH_API_KEY?.trim();
  if (!project && !apiKey) return undefined;
  return {
    provider: project?.provider ?? "tavily",
    ...(project?.baseURL ? { baseURL: project.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}
