import { Box, Text } from "ink";
import { commandDefinitions, commandLabel } from "../../commands/definitions.js";
import { theme } from "../../theme/index.js";
import { Key } from "../layout/chrome.js";

export function HelpDialog() {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.muted}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold>Help</Text>
        <Text dimColor>Esc close</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Commands</Text>
        {commandDefinitions.map((command) => (
          <Text key={command.name}>
            <Text color={theme.accent}>{commandLabel(command).padEnd(20)}</Text>
            <Text dimColor>{command.description}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Keyboard</Text>
        <Text>
          <Key>Enter</Key>
          <Text dimColor> send / steer · </Text>
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
          <Key>Ctrl+P</Key>
          <Text dimColor> plan · </Text>
          <Key>Ctrl+K</Key>
          <Text dimColor> palette</Text>
        </Text>
        <Text>
          <Key>Ctrl+O</Key>
          <Text dimColor> output · </Text>
          <Key>Ctrl+T</Key>
          <Text dimColor> activity · </Text>
          <Key>Ctrl+C</Key>
          <Text dimColor> cancel / press twice to exit</Text>
        </Text>
      </Box>
    </Box>
  );
}
