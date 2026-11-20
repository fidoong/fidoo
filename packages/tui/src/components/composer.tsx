import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { commandDefinitions } from "../commands.js";
import { theme } from "../theme.js";
import { Spinner } from "./spinner.js";

export function Composer({
  enabled,
  onSubmit,
}: {
  enabled: boolean;
  onSubmit(value: string): void;
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const suggestions = value.startsWith("/")
    ? commandDefinitions.filter((command) => command.name.startsWith(value)).slice(0, 5)
    : [];

  useInput(
    (input, key) => {
      if (key.ctrl && input === "j") {
        setValue((current) => `${current}\n`);
      } else if (key.return) {
        const submitted = value.trim();
        if (submitted) {
          setHistory((current) => [...current, submitted]);
          setHistoryIndex(-1);
          setSuggestionIndex(0);
          setValue("");
          onSubmit(submitted);
        }
      } else if (key.escape) {
        setValue("");
        setHistoryIndex(-1);
        setSuggestionIndex(0);
      } else if (key.backspace || key.delete) {
        setSuggestionIndex(0);
        setValue((current) => Array.from(current).slice(0, -1).join(""));
      } else if (key.upArrow) {
        if (suggestions.length > 0) {
          setSuggestionIndex((current) => Math.max(0, current - 1));
        } else {
          const index = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
          if (history[index]) {
            setHistoryIndex(index);
            setValue(history[index]);
          }
        }
      } else if (key.downArrow) {
        if (suggestions.length > 0) {
          setSuggestionIndex((current) => Math.min(suggestions.length - 1, current + 1));
        } else {
          const index = Math.min(history.length, historyIndex + 1);
          setHistoryIndex(index);
          setValue(history[index] ?? "");
        }
      } else if (key.tab && suggestions.length > 0) {
        setValue(suggestions[suggestionIndex]?.name ?? suggestions[0]?.name ?? value);
        setSuggestionIndex(0);
      } else if (!key.ctrl && !key.meta && !key.escape && input) {
        const pasted = input.replace(/\r\n?/g, "\n");
        setSuggestionIndex(0);
        setValue((current) => current + pasted);
      }
    },
    { isActive: enabled },
  );

  return (
    <Box
      flexDirection="column"
      width="100%"
      borderStyle="single"
      borderColor={enabled ? theme.accent : theme.border}
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text dimColor>{enabled ? "Message fidoo" : "Fidoo is working"}</Text>
        <Text dimColor>{enabled ? "Enter ↵" : "Ctrl+C cancel"}</Text>
      </Box>
      {enabled ? (
        <Text wrap="wrap">
          <Text bold color={theme.accent}>
            ›{" "}
          </Text>
          <InputValue value={value} />
        </Text>
      ) : (
        <Text>
          <Spinner active color={theme.accent} /> <Text bold>Working</Text>
          <Text dimColor> · inspect, edit, verify</Text>
        </Text>
      )}
      {enabled && suggestions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Commands · Tab to complete</Text>
          {suggestions.map((command, index) => {
            const selected = index === suggestionIndex;
            return (
              <Text key={command.name}>
                <Text color={selected ? theme.accent : theme.muted}>{selected ? "› " : "  "}</Text>
                <Text bold={selected} color={selected ? theme.accent : theme.brand}>
                  {command.name}
                </Text>
                <Text dimColor> {command.description}</Text>
              </Text>
            );
          })}
        </Box>
      ) : null}
      {enabled && !value ? (
        <Box marginTop={1}>
          <Text dimColor>Ctrl+J newline · Esc clear · Ctrl+K palette · / commands</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function InputValue({ value }: { value: string }) {
  if (value.startsWith("/")) {
    const command = /^\/\S*/.exec(value)?.[0] ?? value;
    return (
      <>
        <Text bold color={theme.accent}>
          {command}
        </Text>
        <Text>{value.slice(command.length)}</Text>
        <Text color={theme.brand}>▌</Text>
      </>
    );
  }
  return (
    <>
      <Text>{value}</Text>
      <Text color={theme.brand}>▌</Text>
    </>
  );
}
