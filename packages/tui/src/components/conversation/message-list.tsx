import { Box, Static, Text, useStdout } from "ink";
import { memo, useMemo, useRef } from "react";
import { appendOnly, buildTimeline, type TimelineEntry } from "../../runtime/timeline.js";
import type { ToolCard, TuiState, ViewMessage } from "../../runtime/types.js";
import { visibleTail } from "../../runtime/viewport.js";
import { theme } from "../../theme/index.js";
import { BrandHeader } from "../layout/brand.js";
import { Spinner } from "../layout/spinner.js";
import { Markdown } from "./markdown.js";
import { ReasoningPanel } from "./reasoning-panel.js";
import { ToolCallCard, ToolGroupCard } from "./tool-call-card.js";

const MessageItem = memo(function MessageItem({ message }: { message: ViewMessage }) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1} maxWidth={96}>
        <Text dimColor>you</Text>
        <Box paddingX={2}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={message.continuation ? 0 : 1} maxWidth={96}>
      {message.continuation ? null : (
        <Text bold color={theme.brand}>
          ƒ fidoo
        </Text>
      )}
      <Box paddingX={2}>
        <Markdown source={message.content} />
      </Box>
    </Box>
  );
});

const CompletedTimeline = memo(function CompletedTimeline({
  entries,
}: {
  entries: TimelineEntry[];
}) {
  const emitted = useRef<TimelineEntry[]>([]);
  const stableEntries = useMemo(() => {
    emitted.current = appendOnly(emitted.current, entries);
    return emitted.current;
  }, [entries]);
  return (
    <Static items={stableEntries}>
      {(entry) =>
        entry.kind === "brand" ? (
          <BrandHeader key={entry.id} provider={entry.provider} model={entry.model} />
        ) : entry.kind === "message" ? (
          <MessageItem key={entry.id} message={entry.message} />
        ) : entry.kind === "tools" ? (
          <ToolGroupCard key={entry.id} tools={entry.tools} />
        ) : null
      }
    </Static>
  );
});

const StreamingMessage = memo(function StreamingMessage({ text }: { text: string }) {
  const { stdout } = useStdout();
  const detected = stdout && "rows" in stdout ? Number(stdout.rows) : 24;
  const rows = detected > 0 ? detected : 24;
  const visible = visibleTail(text, Math.max(6, rows - 12));
  return (
    <Box flexDirection="column" marginBottom={1} maxWidth={96}>
      <Text>
        <Text bold color={theme.brand}>
          ƒ fidoo{" "}
        </Text>
        <Spinner active />
        <Text dimColor> responding</Text>
      </Text>
      <Box paddingX={2}>
        <Markdown source={visible} />
      </Box>
    </Box>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  streamingText,
  tools = [],
  expanded = false,
  reasoningState,
  provider,
  model,
}: {
  messages: ViewMessage[];
  streamingText: string;
  tools?: ToolCard[];
  expanded?: boolean;
  reasoningState?: TuiState;
  provider?: string | undefined;
  model?: string | undefined;
}) {
  const { entries, currentTools, lastCompletedTool } = useMemo(
    () => buildTimeline({ messages, streamingText, tools, provider, model }),
    [messages, tools, provider, model, streamingText],
  );
  const responseMessage =
    reasoningState?.responseStartIndex !== undefined
      ? messages[reasoningState.responseStartIndex]
      : undefined;
  const reasoningVisible = Boolean(
    reasoningState?.reasoningText && !streamingText && !responseMessage,
  );
  return (
    <Box flexDirection="column" marginBottom={1}>
      <CompletedTimeline entries={entries} />
      {currentTools.length > 0 ? (
        <Box paddingX={2}>
          <ToolGroupCard tools={currentTools} />
        </Box>
      ) : null}
      {expanded && lastCompletedTool ? (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text dimColor>output detail</Text>
          <ToolCallCard tool={lastCompletedTool} expanded />
        </Box>
      ) : null}
      {streamingText ? <StreamingMessage text={streamingText} /> : null}
      {reasoningState && reasoningVisible ? (
        <Box paddingX={2}>
          <ReasoningPanel state={reasoningState} expanded={false} />
        </Box>
      ) : null}
    </Box>
  );
});
