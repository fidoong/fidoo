import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { Key } from "./chrome.js";

const commands = [
  ["/new", "Start a clean session"],
  ["/sessions", "Browse and restore saved runs"],
  ["/resume <run-id>", "Restore a run by id"],
  ["/trace", "Inspect canonical run events"],
  ["/theme", "Choose and save the interface theme"],
  ["/reasoning", "Expand or collapse model reasoning"],
  ["/artifact <id>", "Read a saved artifact by id"],
  ["/quit", "Close fidoo"],
] as const;

export function HelpDialog() {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.muted}
      paddingX={1}
      marginY={1}
    >
      <Text bold>Help</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Commands</Text>
        {commands.map(([command, description]) => (
          <Text key={command}>
            <Text color={theme.accent}>{command.padEnd(20)}</Text>
            <Text dimColor>{description}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Keyboard</Text>
        <Text>
          <Key>Enter</Key>
          <Text dimColor> send · </Text>
          <Key>Ctrl+J</Key>
          <Text dimColor> newline · </Text>
          <Key>Esc</Key>
          <Text dimColor> clear / close</Text>
        </Text>
        <Text>
          <Key>↑ / ↓</Key>
          <Text dimColor> history / navigate · </Text>
          <Key>Tab</Key>
          <Text dimColor> complete command</Text>
        </Text>
        <Text>
          <Key>Ctrl+R</Key>
          <Text dimColor> reasoning · </Text>
          <Key>Ctrl+K</Key>
          <Text dimColor> palette · </Text>
          <Key>Ctrl+O</Key>
          <Text dimColor> output · </Text>
          <Key>Ctrl+C</Key>
          <Text dimColor> cancel / press twice to exit</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc close</Text>
      </Box>
    </Box>
  );
}
