import { readFile, stat } from "node:fs/promises";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import {
  assertNotSensitive,
  relativePath,
  resolveExistingPath,
  revisionOf,
} from "../system/workspace.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path"),
  offset: z.number().int().min(1).default(1).describe("First 1-based line to return"),
  limit: z.number().int().min(1).max(2000).default(400).describe("Maximum lines"),
});

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read a UTF-8 text file with line numbers and a revision hash. Use offset and limit for large files. The revision is required when editing the same file.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    const path = await resolveExistingPath(context.cwd, input.path);
    assertNotSensitive(path);
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new AgentError(`Not a file: ${input.path}`, "tool");
    }
    const source = await readFile(path, "utf8");
    const lines = source.split("\n");
    const selected = lines
      .slice(input.offset - 1, input.offset - 1 + input.limit)
      .map((line, index) => `${input.offset + index}\t${line}`)
      .join("\n");
    const relative = relativePath(context.cwd, path);
    const content = `File: ${relative}\nRevision: ${revisionOf(source)}\nLines: ${input.offset}-${Math.min(lines.length, input.offset + input.limit - 1)} of ${lines.length}\n\n${selected}`;
    return {
      summary: `Read ${relative}`,
      content: await boundedOutput(context, `read-${relative}.txt`, content),
    };
  },
});
