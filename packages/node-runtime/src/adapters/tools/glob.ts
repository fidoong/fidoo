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
  pattern: z.string().min(1).describe("File name pattern, for example src/**/*.ts"),
  path: z.string().default(".").describe("Workspace-relative directory to search"),
});

export const globTool = defineTool({
  name: "glob",
  description:
    "Find files by path pattern without reading file contents. Results respect .gitignore and common build directories. Maximum 500 files.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input, context) => {
    assertSafeGlob(input.pattern);
    const directory = await resolveExistingPath(context.cwd, input.path);
    const ignored = await workspaceIgnore(context.cwd);
    const paths = await fg(input.pattern, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"],
    });
    const visible = paths
      .filter((path) => {
        try {
          assertNotSensitive(path);
          return !ignored(relative(context.cwd, path));
        } catch {
          return false;
        }
      })
      .sort();
    const truncated = visible.length > 500;
    const files = visible.slice(0, 500).map((path) => relative(context.cwd, path));
    const suffix = truncated ? `\n[Truncated: ${visible.length - 500} more files]` : "";
    return {
      summary: `Found ${visible.length} files`,
      content: await boundedOutput(context, "glob.txt", `${files.join("\n")}${suffix}`),
    };
  },
});
