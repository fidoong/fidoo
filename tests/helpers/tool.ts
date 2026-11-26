import type { SubagentPort, SubagentResult, ToolDefinition, ToolResult } from "@fidoo/core";
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
    onSubagentStarted?(runId: string): void;
    onSubagentFinished?(result: SubagentResult): void;
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
    ...(options.onSubagentStarted ? { onSubagentStarted: options.onSubagentStarted } : {}),
    ...(options.onSubagentFinished ? { onSubagentFinished: options.onSubagentFinished } : {}),
    ...(options.subagents ? { subagents: options.subagents } : {}),
  });
}
