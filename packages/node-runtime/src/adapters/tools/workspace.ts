import { defineTool } from "@fidoo/core";
import { z } from "zod";
import type { WorkspaceChangeManager } from "../changes/workspace-change-manager.js";
import { boundedOutput } from "./output.js";

export function createWorkspaceTools(changes: WorkspaceChangeManager) {
  const statusTool = defineTool({
    name: "workspace_status",
    description:
      "Inspect files changed by the current run using pre-mutation snapshots. Works without Git and reports whether each change can be safely undone.",
    inputSchema: z.object({}),
    effect: "read",
    risk: "low",
    concurrency: "safe",
    idempotency: "always",
    execute: async (_input, context) => {
      const summary = await changes.list(context.cwd, context.runId);
      return {
        summary: `${summary.files} changed files · +${summary.addedLines} -${summary.deletedLines}`,
        content: JSON.stringify(
          {
            ...summary,
            changes: summary.changes.map(({ diff: _diff, ...change }) => change),
          },
          null,
          2,
        ),
      };
    },
  });

  const diffTool = defineTool({
    name: "workspace_diff",
    description:
      "Show unified diffs for current-run changes against their pre-Agent snapshots. Optionally restrict to specific workspace-relative paths.",
    inputSchema: z.object({ paths: z.array(z.string().min(1)).default([]) }),
    effect: "read",
    risk: "low",
    concurrency: "safe",
    idempotency: "always",
    execute: async (input, context) => {
      const summary = await changes.list(context.cwd, context.runId);
      const selected = input.paths.length
        ? summary.changes.filter((change) => input.paths.includes(change.path))
        : summary.changes;
      const content = selected.length
        ? selected.map((change) => change.diff).join("\n\n")
        : "No recorded workspace changes.";
      return {
        summary: `Diff for ${selected.length} files`,
        ...(await boundedOutput(context, "workspace.diff", content, 48_000)),
      };
    },
  });
  return [statusTool, diffTool];
}
