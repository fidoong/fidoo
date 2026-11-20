import type { ToolDefinition, ToolResult } from "@fidoo/core";
import { MemoryArtifactStore } from "@fidoo/node-runtime";

export function executeTool(
  tool: ToolDefinition,
  input: unknown,
  options: { cwd: string; runId?: string; artifacts?: MemoryArtifactStore },
): Promise<ToolResult> {
  return tool.execute(tool.inputSchema.parse(input), {
    cwd: options.cwd,
    runId: options.runId ?? "test-run",
    signal: new AbortController().signal,
    artifacts: options.artifacts ?? new MemoryArtifactStore(),
  });
}
