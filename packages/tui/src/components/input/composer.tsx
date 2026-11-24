import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { commandDefinitions, commandLabel } from "../../commands/definitions.js";
import { theme } from "../../theme/index.js";
import { Spinner } from "../layout/spinner.js";

export function Composer({
  enabled,
  busy = false,
  onSubmit,
}: {
  enabled: boolean;
  busy?: boolean;
  onSubmit(value: string): void;
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const suggestions = value.startsWith("/")
    ? commandDefinitions.filter((command) => command.name.startsWith(value))
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
        const command = suggestions[suggestionIndex] ?? suggestions[0];
        setValue(command ? `${command.name}${command.usage ? " " : ""}` : value);
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
    <Box flexDirection="column" width="100%">
      <Box width="100%" justifyContent="space-between">
        <Box flexGrow={1}>
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
            </Text>
          )}
        </Box>
        <Text dimColor>
          {enabled
            ? busy
              ? "Enter steer · Ctrl+C cancel"
              : value
                ? "Enter send"
                : "Enter send · / commands"
            : "Ctrl+C cancel"}
        </Text>
      </Box>
      {enabled && suggestions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{suggestions.length} commands · ↑/↓ select · Tab complete</Text>
          {suggestions.map((command, index) => {
            const selected = index === suggestionIndex;
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
