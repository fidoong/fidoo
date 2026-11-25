import type { ToolDefinition } from "@fidoo/core";
import type { WorkspaceChangeManager } from "./workspace-change-manager.js";

export function trackMutation(
  tool: ToolDefinition,
  changes: WorkspaceChangeManager,
): ToolDefinition {
  return {
    ...tool,
    execute: async (input, context) => {
      const paths = mutationPaths(input);
      await changes.capture(context.cwd, context.runId, paths);
      const result = await tool.execute(input, context);
      if (result.success !== false) {
        await changes.afterMutation(context.cwd, context.runId, result.changedFiles ?? paths);
      }
      return result;
    },
  };
}

function mutationPaths(input: unknown): string[] {
  if (typeof input !== "object" || input === null || !("path" in input)) return [];
  const path = (input as { path: unknown }).path;
  return typeof path === "string" ? [path] : [];
}
