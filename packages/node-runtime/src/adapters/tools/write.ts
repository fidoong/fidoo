import { readFile } from "node:fs/promises";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import { atomicWrite, prepareWritePath } from "../system/files.js";
import { assertNotSensitive, relativePath, revisionOf } from "../system/workspace.js";

const inputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  expected_revision: z
    .string()
    .length(64)
    .optional()
    .describe("Required when overwriting an existing file"),
});

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Create a file or atomically replace an existing file. Existing files must be read first and protected with expected_revision. Content is not normalized.",
  inputSchema,
  effect: "write",
  risk: "medium",
  concurrency: "exclusive",
  idempotency: "reconcile",
  execute: async (input, context) => {
    const path = await prepareWritePath(context.cwd, input.path);
    assertNotSensitive(path);
    let previous: string | undefined;
    try {
      previous = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if (previous !== undefined) {
      if (!input.expected_revision) {
        throw new AgentError("File exists; read it and provide expected_revision", "tool");
      }
      if (revisionOf(previous) !== input.expected_revision) {
        throw new AgentError("File revision changed; read the file again before writing", "tool");
      }
    }
    await atomicWrite(path, input.content);
    const relative = relativePath(context.cwd, path);
    return {
      summary: `${previous === undefined ? "Created" : "Rewrote"} ${relative}`,
      content: `${relative}: ${Buffer.byteLength(input.content)} bytes written`,
      changedFiles: [relative],
    };
  },
});
