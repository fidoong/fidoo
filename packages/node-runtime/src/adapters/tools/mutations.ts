import { readFile, rename, rm, stat } from "node:fs/promises";
import { AgentError, defineTool } from "@fidoo/core";
import { z } from "zod";
import type { WorkspaceChangeManager } from "../changes/workspace-change-manager.js";
import { atomicWrite, prepareWritePath } from "../system/files.js";
import {
  assertNotSensitive,
  relativePath,
  resolveExistingPath,
  revisionOf,
} from "../system/workspace.js";
import { boundedOutput } from "./output.js";

export function createMutationTools(changes: WorkspaceChangeManager) {
  const applyPatchTool = defineTool({
    name: "apply_patch",
    description:
      "Apply exact replacements across one or more files as a validated batch. Every existing file needs expected_revision from read_file. All files are validated before writing; a write failure restores already-written files.",
    inputSchema: z.object({
      files: z
        .array(
          z.object({
            path: z.string().min(1),
            expected_revision: z.string().length(64),
            edits: z
              .array(
                z.object({
                  old_string: z.string().min(1),
                  new_string: z.string(),
                  replace_all: z.boolean().default(false),
                }),
              )
              .min(1),
          }),
        )
        .min(1),
    }),
    effect: "write",
    risk: "medium",
    concurrency: "exclusive",
    idempotency: "reconcile",
    execute: async (input, context) => {
      const paths = input.files.map((file) => file.path);
      if (new Set(paths).size !== paths.length) {
        throw new AgentError("apply_patch cannot contain duplicate file paths", "tool");
      }
      const prepared: { path: string; relative: string; before: string; after: string }[] = [];
      for (const file of input.files) {
        const path = await resolveExistingPath(context.cwd, file.path);
        assertNotSensitive(path);
        const before = await readFile(path, "utf8");
        if (revisionOf(before) !== file.expected_revision) {
          throw new AgentError(`File revision changed: ${file.path}; read it again`, "tool");
        }
        let after = before;
        for (const edit of file.edits) {
          const occurrences = after.split(edit.old_string).length - 1;
          if (occurrences === 0) {
            throw new AgentError(`old_string not found in ${file.path}`, "tool");
          }
          if (occurrences > 1 && !edit.replace_all) {
            throw new AgentError(
              `old_string occurs ${occurrences} times in ${file.path}; add context or set replace_all`,
              "tool",
            );
          }
          after = edit.replace_all
            ? after.replaceAll(edit.old_string, edit.new_string)
            : after.replace(edit.old_string, edit.new_string);
        }
        prepared.push({ path, relative: relativePath(context.cwd, path), before, after });
      }
      const relativePaths = prepared.map((file) => file.relative);
      await changes.capture(context.cwd, context.runId, relativePaths);
      const written: typeof prepared = [];
      try {
        for (const file of prepared) {
          await atomicWrite(file.path, file.after);
          written.push(file);
        }
      } catch (error) {
        for (const file of written) await atomicWrite(file.path, file.before);
        throw error;
      }
      await changes.afterMutation(context.cwd, context.runId, relativePaths);
      const summary = await changes.list(context.cwd, context.runId);
      const diff = summary.changes
        .filter((change) => relativePaths.includes(change.path))
        .map((change) => change.diff)
        .join("\n\n");
      return {
        summary: `Patched ${prepared.length} files`,
        ...(await boundedOutput(context, "apply-patch.diff", diff, 48_000)),
        changedFiles: prepared.map((file) => file.relative),
      };
    },
  });

  const moveFileTool = defineTool({
    name: "move_file",
    description:
      "Move or rename a file inside the workspace. Requires the source revision and refuses to overwrite an existing target.",
    inputSchema: z.object({
      source_path: z.string().min(1),
      target_path: z.string().min(1),
      expected_revision: z.string().length(64),
    }),
    effect: "write",
    risk: "medium",
    concurrency: "exclusive",
    idempotency: "reconcile",
    execute: async (input, context) => {
      if (input.source_path === input.target_path) {
        throw new AgentError("Source and target paths are identical", "tool");
      }
      const source = await resolveExistingPath(context.cwd, input.source_path);
      assertNotSensitive(source);
      const content = await readFile(source, "utf8");
      if (revisionOf(content) !== input.expected_revision) {
        throw new AgentError("Source file revision changed; read it again", "tool");
      }
      const target = await prepareWritePath(context.cwd, input.target_path);
      assertNotSensitive(target);
      if (await exists(target)) {
        throw new AgentError(`Target already exists: ${input.target_path}`, "tool");
      }
      await changes.capture(context.cwd, context.runId, [input.source_path, input.target_path]);
      await rename(source, target);
      await changes.afterMutation(context.cwd, context.runId, [
        input.source_path,
        input.target_path,
      ]);
      const changedFiles = [relativePath(context.cwd, source), relativePath(context.cwd, target)];
      return {
        summary: `Moved ${changedFiles[0]} to ${changedFiles[1]}`,
        content: JSON.stringify({ source: changedFiles[0], target: changedFiles[1] }),
        changedFiles,
      };
    },
  });

  const deleteFileTool = defineTool({
    name: "delete_file",
    description:
      "Delete one workspace file after verifying its expected revision. Directories are not accepted.",
    inputSchema: z.object({
      path: z.string().min(1),
      expected_revision: z.string().length(64),
    }),
    effect: "write",
    risk: "medium",
    concurrency: "exclusive",
    idempotency: "reconcile",
    execute: async (input, context) => {
      const path = await resolveExistingPath(context.cwd, input.path);
      assertNotSensitive(path);
      if (!(await stat(path)).isFile()) throw new AgentError("Not a file", "tool");
      const content = await readFile(path, "utf8");
      if (revisionOf(content) !== input.expected_revision) {
        throw new AgentError("File revision changed; read it again", "tool");
      }
      await changes.capture(context.cwd, context.runId, [input.path]);
      await rm(path);
      await changes.afterMutation(context.cwd, context.runId, [input.path]);
      const relative = relativePath(context.cwd, path);
      return { summary: `Deleted ${relative}`, content: relative, changedFiles: [relative] };
    },
  });

  const undoFileTool = defineTool({
    name: "undo_file",
    description:
      "Restore one file to its snapshot before the current run's first Agent mutation. Requires approval and refuses to overwrite later external edits.",
    inputSchema: z.object({ path: z.string().min(1) }),
    effect: "write",
    risk: "high",
    concurrency: "exclusive",
    idempotency: "reconcile",
    execute: async (input, context) => {
      await changes.undoFile(context.cwd, context.runId, input.path);
      return {
        summary: `Restored ${input.path}`,
        content: `Restored ${input.path} from its pre-run snapshot`,
        changedFiles: [input.path],
      };
    },
  });

  const undoRunTool = defineTool({
    name: "undo_run",
    description:
      "Restore every file changed by the current run to its pre-Agent snapshot. Requires approval; all files are checked for external edits before any restore.",
    inputSchema: z.object({}),
    effect: "write",
    risk: "high",
    concurrency: "exclusive",
    idempotency: "reconcile",
    execute: async (_input, context) => {
      const restored = await changes.undoRun(context.cwd, context.runId);
      return {
        summary: `Restored ${restored.length} files`,
        content: JSON.stringify({ restored }),
        ...(restored.length ? { changedFiles: restored } : {}),
      };
    },
  });
  return [applyPatchTool, moveFileTool, deleteFileTool, undoFileTool, undoRunTool];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
