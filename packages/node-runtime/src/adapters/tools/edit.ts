import { readFile } from "node:fs/promises";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import { atomicWrite } from "../system/files.js";
import {
  assertNotSensitive,
  relativePath,
  resolveExistingPath,
  revisionOf,
} from "../system/workspace.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  path: z.string().min(1),
  old_string: z.string().min(1).describe("Exact existing text; must occur exactly once"),
  new_string: z.string().describe("Replacement text, preserved byte-for-byte as UTF-8"),
  expected_revision: z.string().length(64).describe("Revision returned by read_file"),
  replace_all: z.boolean().default(false),
});

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Replace exact text atomically. Read the file first and pass its revision. Fails instead of guessing when the text is absent, ambiguous, or the file changed externally.",
  inputSchema,
  effect: "write",
  risk: "medium",
  concurrency: "exclusive",
  idempotency: "reconcile",
  execute: async (input, context) => {
    const path = await resolveExistingPath(context.cwd, input.path);
    assertNotSensitive(path);
    const source = await readFile(path, "utf8");
    if (revisionOf(source) !== input.expected_revision) {
      throw new AgentError("File revision changed; read the file again before editing", "tool");
    }
    const occurrences = source.split(input.old_string).length - 1;
    if (occurrences === 0) {
      throw new AgentError("old_string was not found", "tool");
    }
    if (occurrences > 1 && !input.replace_all) {
      throw new AgentError(
        `old_string occurs ${occurrences} times; provide more context or set replace_all`,
        "tool",
      );
    }
    const updated = input.replace_all
      ? source.replaceAll(input.old_string, input.new_string)
      : source.replace(input.old_string, input.new_string);
    await atomicWrite(path, updated);
    const relative = relativePath(context.cwd, path);
    const diff = `--- ${relative}\n+++ ${relative}\n${input.old_string
      .split("\n")
      .map((line) => `-${line}`)
      .join("\n")}\n${input.new_string
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n")}`;
    return {
      summary: `Edited ${relative}`,
      content: await boundedOutput(context, `edit-${relative}.diff`, diff),
      changedFiles: [relative],
    };
  },
});
