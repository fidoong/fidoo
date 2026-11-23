import { basename } from "node:path";
import type { ToolContext, ToolResult } from "@fidoo/core";

const DEFAULT_LIMIT = 16_000;

export async function boundedOutput(
  context: ToolContext,
  name: string,
  content: string,
  limit = DEFAULT_LIMIT,
): Promise<Pick<ToolResult, "content" | "artifacts">> {
  if (Buffer.byteLength(content) <= limit) {
    return { content };
  }
  const artifact = await context.artifacts.save(context.runId, name, content);
  const head = content.slice(0, Math.floor(limit * 0.6));
  const tail = content.slice(-Math.floor(limit * 0.3));
  return {
    content: `${head}\n\n[Output truncated: ${artifact.bytes} bytes; artifact ${artifact.id}]\n\n${tail}`,
    artifacts: [{ id: artifact.id, name: basename(name), bytes: artifact.bytes }],
  };
}
