import { defineTool } from "@fidoo/core";
import { z } from "zod";
import { buildRepoIndex, formatRepoIndex } from "../repo/repo-index.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  path: z.string().default(".").describe("Workspace-relative directory to index"),
  maxFiles: z
    .number()
    .int()
    .min(10)
    .max(500)
    .default(200)
    .describe("Maximum prioritized files to inspect"),
});

export const repoMapTool = defineTool({
  name: "repo_map",
  description:
    "Build a bounded structural map of an unfamiliar repository: languages, top directories, entry points, tests, prioritized files, symbols and imports. Use this before broad exploration of a multi-step task.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    const result = await buildRepoIndex(context.cwd, input.path, input.maxFiles);
    return {
      summary: `Mapped ${result.totalFiles} files in ${input.path}`,
      ...(await boundedOutput(context, "repo-map.txt", formatRepoIndex(result))),
    };
  },
});
