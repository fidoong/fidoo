import type { ToolCard, ViewMessage } from "./types.js";

export type MessageEntry = { id: string; seq: number; kind: "message"; message: ViewMessage };
export type ToolEntry = { id: string; seq: number; kind: "tool"; tool: ToolCard };
export type BrandEntry = {
  id: string;
  seq: number;
  kind: "brand";
  provider: string | undefined;
  model: string | undefined;
};
export type TimelineEntry =
  | MessageEntry
  | ToolEntry
  | BrandEntry
  | { id: string; seq: number; kind: "tools"; tools: ToolCard[] };

export interface TimelineInput {
  messages: ViewMessage[];
  streamingText: string;
  tools: ToolCard[];
  provider?: string | undefined;
  model?: string | undefined;
}

export function buildTimeline(input: TimelineInput) {
  const { messages, tools, provider, model } = input;
  const completed = tools.filter((tool) => tool.status === "success" || tool.status === "error");
  const ordered: Array<MessageEntry | ToolEntry> = [
    ...messages.map<MessageEntry>((message) => ({
      id: message.id,
      seq: message.seq,
      kind: "message",
      message,
    })),
    ...completed.map<ToolEntry>((tool) => ({
      id: tool.id,
      seq: tool.seq,
      kind: "tool",
      tool,
    })),
  ].sort(
    (left, right) =>
      left.seq - right.seq || Number(left.kind === "message") - Number(right.kind === "message"),
  );
  const entries: TimelineEntry[] =
    provider || model ? [{ id: "brand", seq: -1, kind: "brand", provider, model }] : [];
  let pendingTools: ToolCard[] = [];
  const flushTools = () => {
    const first = pendingTools[0];
    const last = pendingTools.at(-1);
    if (first && last) {
      entries.push({
        id: `tools-${first.id}-${last.id}`,
        seq: last.seq,
        kind: "tools",
        tools: pendingTools,
      });
      pendingTools = [];
    }
  };
  for (const entry of ordered) {
    if (entry.kind === "tool") {
      pendingTools.push(entry.tool);
    } else {
      flushTools();
      entries.push(entry);
    }
  }
  return {
    entries,
    currentTools: [
      ...pendingTools,
      ...tools.filter((tool) => tool.status !== "success" && tool.status !== "error"),
    ].sort((left, right) => left.seq - right.seq),
    lastCompletedTool: completed.toSorted((left, right) => left.seq - right.seq).at(-1),
  };
}

export function appendOnly<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const known = new Set(previous.map((entry) => entry.id));
  const additions = next.filter((entry) => !known.has(entry.id));
  return additions.length > 0 ? [...previous, ...additions] : previous;
}
