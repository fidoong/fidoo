import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { defineTool } from "@fidoo/core";
import fg from "fast-glob";
import { z } from "zod";
import {
  assertNotSensitive,
  assertSafeGlob,
  resolveExistingPath,
  workspaceIgnore,
} from "../system/workspace.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  pattern: z.string().min(1).describe("JavaScript regular expression to match"),
  path: z.string().default(".").describe("Workspace-relative directory to search"),
  glob: z.string().default("**/*").describe("File pattern to include"),
  maxResults: z.number().int().min(1).max(500).default(100),
});

export const grepTool = defineTool({
  name: "grep",
  description:
    "Search UTF-8 file contents with a regular expression and return path:line:text matches. Use glob for path-only searches. Binary, ignored, and files over 1 MiB are skipped.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    assertSafeGlob(input.glob);
    const directory = await resolveExistingPath(context.cwd, input.path);
    const expression = new RegExp(input.pattern, "u");
    const ignored = await workspaceIgnore(context.cwd);
    const paths = await fg(input.glob, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"],
    });
    const matches: string[] = [];
    let searchedFiles = 0;
    for (const path of paths.sort()) {
      if (matches.length >= input.maxResults || searchedFiles >= 2000) {
        break;
      }
      try {
        assertNotSensitive(path);
        if (ignored(relative(context.cwd, path)) || (await stat(path)).size > 1024 * 1024) {
          continue;
        }
        searchedFiles += 1;
        const lines = (await readFile(path, "utf8")).split("\n");
        for (const [index, line] of lines.entries()) {
          if (expression.test(line)) {
            matches.push(`${relative(context.cwd, path)}:${index + 1}:${line}`);
            if (matches.length >= input.maxResults) {
              break;
            }
          }
        }
      } catch {}
    }
    return {
      summary: `Found ${matches.length} matches in ${searchedFiles} searched files`,
      content: await boundedOutput(context, "grep.txt", matches.join("\n")),
    };
  },
});
