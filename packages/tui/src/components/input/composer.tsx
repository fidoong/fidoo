import { Box, Text, useInput } from "ink";
import { useSyncExternalStore } from "react";
import { commandDefinitions, commandLabel } from "../../commands/definitions.js";
import type { ComposerStore } from "../../runtime/composer-store.js";
import { theme } from "../../theme/index.js";
import { Spinner } from "../layout/spinner.js";

export function Composer({
  enabled,
  busy = false,
  store,
  onSubmit,
}: {
  enabled: boolean;
  busy?: boolean;
  store: ComposerStore;
  onSubmit(value: string): void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const suggestions = state.value.startsWith("/")
    ? commandDefinitions.filter((command) => command.name.startsWith(state.value))
    : [];

  useInput(
    (input, key) => {
      if (key.ctrl && input === "j") {
        store.insert("\n");
      } else if (key.ctrl && input === "a") {
        store.moveLineStart();
      } else if (key.ctrl && input === "e") {
        store.moveLineEnd();
      } else if (key.ctrl && input === "u") {
        store.clear();
      } else if (key.return) {
        const submitted = store.submit();
        if (submitted) onSubmit(submitted);
      } else if (key.escape) {
        store.clear();
      } else if (key.leftArrow) {
        store.moveLeft();
      } else if (key.rightArrow) {
        store.moveRight();
      } else if (key.backspace || key.delete) {
        store.backspace();
      } else if (key.upArrow) {
        if (suggestions.length > 0) store.moveSuggestion(-1, suggestions.length);
        else if (!store.moveVertical(-1)) store.historyPrevious();
      } else if (key.downArrow) {
        if (suggestions.length > 0) store.moveSuggestion(1, suggestions.length);
        else if (!store.moveVertical(1)) store.historyNext();
      } else if (key.tab && suggestions.length > 0) {
        const command = suggestions[state.suggestionIndex] ?? suggestions[0];
        if (command) store.complete(`${command.name}${command.usage ? " " : ""}`);
      } else if (!key.ctrl && !key.meta && !key.escape && input) {
        store.insert(input);
      }
    },
    { isActive: enabled },
  );

  return (
    <Box flexDirection="column" width="100%">
      <Box width="100%" justifyContent="space-between">
        <Box flexGrow={1}>
          {enabled ? (
            <Text wrap="wrap">
              <Text bold color={theme.accent}>
                ›{" "}
              </Text>
              <InputValue value={state.value} cursor={state.cursor} />
            </Text>
          ) : (
            <Text>
              <Spinner active color={theme.accent} /> <Text bold>Working</Text>
            </Text>
          )}
        </Box>
        <Text dimColor>
          {enabled
            ? busy
              ? "Enter steer · Ctrl+C cancel"
              : state.value
                ? "Enter send"
                : "Enter send · / commands"
            : "Ctrl+C cancel"}
        </Text>
      </Box>
      {enabled && suggestions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{suggestions.length} commands · ↑/↓ select · Tab complete</Text>
          {suggestions.map((command, index) => {
            const selected = index === state.suggestionIndex;
            return (
              <Text key={command.name}>
                <Text color={selected ? theme.accent : theme.muted}>{selected ? "› " : "  "}</Text>
                <Text bold={selected} color={selected ? theme.accent : theme.brand}>
                  {commandLabel(command)}
                </Text>
                <Text dimColor> {command.description}</Text>
              </Text>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

function InputValue({ value, cursor }: { value: string; cursor: number }) {
  const characters = Array.from(value);
  const before = characters.slice(0, cursor).join("");
  const after = characters.slice(cursor).join("");
  const content = (
    <>
      <Text>{before}</Text>
      <Text color={theme.brand}>▌</Text>
      <Text>{after}</Text>
    </>
  );
  if (value.startsWith("/")) {
    const match = /^\/\S*/.exec(value)?.[0] ?? value;
    const commandEnd = Array.from(match).length;
    if (cursor >= commandEnd) {
      return (
        <>
          <Text bold color={theme.accent}>
            {match}
          </Text>
          <Text>{characters.slice(commandEnd, cursor).join("")}</Text>
          <Text color={theme.brand}>▌</Text>
          <Text>{after}</Text>
        </>
      );
    }
  }
  return content;
}
