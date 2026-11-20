import type { ToolContext } from "@fidoo/core";

const DEFAULT_LIMIT = 16_000;

export async function boundedOutput(
  context: ToolContext,
  name: string,
  content: string,
  limit = DEFAULT_LIMIT,
): Promise<string> {
  if (Buffer.byteLength(content) <= limit) {
    return content;
  }
  const artifact = await context.artifacts.save(context.runId, name, content);
  const head = content.slice(0, Math.floor(limit * 0.6));
  const tail = content.slice(-Math.floor(limit * 0.3));
  return `${head}\n\n[Output truncated: ${artifact.bytes} bytes saved to ${artifact.path}]\n\n${tail}`;
}
