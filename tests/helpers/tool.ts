import type { SubagentPort, ToolDefinition, ToolResult } from "@fidoo/core";
import { MemoryArtifactStore } from "@fidoo/node-runtime";

export function executeTool(
  tool: ToolDefinition,
  input: unknown,
  options: {
    cwd: string;
    runId?: string;
    artifacts?: MemoryArtifactStore;
    signal?: AbortSignal;
    onOutput?(text: string): void;
    subagents?: SubagentPort;
  },
): Promise<ToolResult> {
  return tool.execute(tool.inputSchema.parse(input), {
    cwd: options.cwd,
    runId: options.runId ?? "test-run",
    callId: "test-call",
    signal: options.signal ?? new AbortController().signal,
    artifacts: options.artifacts ?? new MemoryArtifactStore(),
    ...(options.onOutput ? { onOutput: options.onOutput } : {}),
    ...(options.subagents ? { subagents: options.subagents } : {}),
  });
}
