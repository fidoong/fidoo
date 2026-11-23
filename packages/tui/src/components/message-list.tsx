import { Box, Static, Text } from "ink";
import { memo, useMemo } from "react";
import { theme } from "../theme.js";
import type { ToolCard, TuiState, ViewMessage } from "../types.js";
import { BrandHeader } from "./brand.js";
import { Markdown } from "./markdown.js";
import { ReasoningPanel } from "./reasoning-panel.js";
import { Spinner } from "./spinner.js";
import { ToolCallCard, ToolGroupCard } from "./tool-call-card.js";

type MessageEntry = { id: string; seq: number; kind: "message"; message: ViewMessage };
type ToolEntry = { id: string; seq: number; kind: "tool"; tool: ToolCard };
type BrandEntry = {
  id: string;
  seq: number;
  kind: "brand";
  provider: string | undefined;
  model: string | undefined;
};
type TimelineEntry =
  | MessageEntry
  | BrandEntry
  | { id: string; seq: number; kind: "tools"; tools: ToolCard[] };

const MessageItem = memo(function MessageItem({ message }: { message: ViewMessage }) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>you</Text>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={message.continuation ? 0 : 1}>
      {message.continuation ? null : (
        <Text bold color={theme.brand}>
          ƒ fidoo
        </Text>
      )}
      <Markdown source={message.content} />
    </Box>
  );
});

const CompletedTimeline = memo(function CompletedTimeline({
  entries,
}: {
  entries: TimelineEntry[];
}) {
  return (
    <Static items={entries}>
      {(entry) =>
        entry.kind === "brand" ? (
          <BrandHeader key={entry.id} provider={entry.provider} model={entry.model} />
        ) : entry.kind === "message" ? (
          <MessageItem key={entry.id} message={entry.message} />
        ) : (
          <ToolGroupCard key={entry.id} tools={entry.tools} />
        )
      }
    </Static>
  );
});

const StreamingMessage = memo(function StreamingMessage({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color={theme.brand}>
          ƒ fidoo{" "}
        </Text>
        <Spinner active />
        <Text dimColor> responding</Text>
      </Text>
      <Markdown source={text} />
    </Box>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  streamingText,
  tools = [],
  expanded = false,
  reasoningState,
  reasoningExpanded = false,
  provider,
  model,
}: {
  messages: ViewMessage[];
  streamingText: string;
  tools?: ToolCard[];
  expanded?: boolean;
  reasoningState?: TuiState;
  reasoningExpanded?: boolean;
  provider?: string | undefined;
  model?: string | undefined;
}) {
  const finalReasoningIndex = reasoningState?.reasoningMessageId
    ? messages.findIndex((message) => message.id === reasoningState.reasoningMessageId)
    : -1;
  const responseActive = reasoningState?.responseActive ?? false;
  let reasoningStart = finalReasoningIndex;
  if (finalReasoningIndex < 0 && responseActive) {
    reasoningStart = messages.findLastIndex((message) => message.role === "user") + 1;
  }
  while (
    reasoningStart > 0 &&
    messages[reasoningStart]?.continuation &&
    messages[reasoningStart - 1]?.role === "assistant"
  ) {
    reasoningStart -= 1;
  }
  const reasoningMessages =
    finalReasoningIndex >= 0 || (responseActive && reasoningStart < messages.length)
      ? messages
          .slice(
            reasoningStart,
            finalReasoningIndex >= 0 ? finalReasoningIndex + 1 : messages.length,
          )
          .filter((message) => message.role === "assistant")
      : [];
  const reasoningMessageIds = new Set(reasoningMessages.map((message) => message.id));
  const { entries, currentTools, lastCompletedTool } = useMemo(() => {
    const completed = tools.filter((tool) => tool.status === "success" || tool.status === "error");
    const timelineMessages = messages.filter((message) => !reasoningMessageIds.has(message.id));
    const ordered: Array<MessageEntry | ToolEntry> = [
      ...timelineMessages.map<MessageEntry>((message) => ({
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
  }, [messages, tools, provider, model, reasoningMessageIds]);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <CompletedTimeline entries={entries} />
      {currentTools.length > 0 ? <ToolGroupCard tools={currentTools} /> : null}
      {expanded && lastCompletedTool ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>output detail</Text>
          <ToolCallCard tool={lastCompletedTool} expanded />
        </Box>
      ) : null}
      {reasoningState ? (
        <ReasoningPanel state={reasoningState} expanded={reasoningExpanded} />
      ) : null}
      {reasoningMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {streamingText ? <StreamingMessage text={streamingText} /> : null}
    </Box>
  );
});
