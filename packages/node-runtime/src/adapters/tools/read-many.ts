import { readdir, stat } from "node:fs/promises";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import { relativePath, resolveExistingPath } from "../system/workspace.js";
import { boundedOutput } from "./output.js";
import { readFileTool } from "./read.js";

export const readManyFilesTool = defineTool({
  name: "read_many_files",
  description:
    "Read up to 20 UTF-8 text files concurrently with a shared offset and line limit. Each result keeps its own path and revision.",
  inputSchema: z.object({
    paths: z.array(z.string().min(1)).min(1).max(20),
    offset: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(1000).default(300),
  }),
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    const results = await Promise.all(
      input.paths.map((path) =>
        readFileTool.execute({ path, offset: input.offset, limit: input.limit }, context),
      ),
    );
    const content = results.map((result) => result.content).join("\n\n---\n\n");
    return {
      summary: `Read ${results.length} files`,
      ...(await boundedOutput(context, "read-many.txt", content, 48_000)),
    };
  },
});

export const listDirectoryTool = defineTool({
  name: "list_directory",
  description:
    "List immediate entries of a workspace directory without recursive traversal. Directories are marked with a trailing slash.",
  inputSchema: z.object({
    path: z.string().min(1).default("."),
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    const path = await resolveExistingPath(context.cwd, input.path);
    if (!(await stat(path)).isDirectory()) {
      throw new AgentError(`Not a directory: ${input.path}`, "tool");
    }
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort(
      (left, right) =>
        Number(right.isDirectory()) - Number(left.isDirectory()) ||
        left.name.localeCompare(right.name),
    );
    const selected = entries.slice(0, input.limit);
    const content = [
      `Directory: ${relativePath(context.cwd, path)}`,
      `Entries: ${selected.length} of ${entries.length}`,
      "",
      ...selected.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`),
    ].join("\n");
    return {
      summary: `Listed ${selected.length} entries in ${relativePath(context.cwd, path)}`,
      content,
    };
  },
});
