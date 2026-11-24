import { Box, Text } from "ink";
import { commandLabel, paletteDefinitions } from "../../commands/definitions.js";
import { theme } from "../../theme/index.js";

export function CommandDialog({ selected }: { selected: number }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>Command palette</Text>
        <Text dimColor>Ctrl+K</Text>
      </Box>
      {paletteDefinitions.map((command, index) => {
        const active = index === selected;
        return (
          <Box key={command.name} justifyContent="space-between">
            <Text>
              <Text color={active ? theme.accent : theme.muted}>{active ? "› " : "  "}</Text>
              <Text bold={active} color={active ? theme.accent : theme.brand}>
                {commandLabel(command).padEnd(12)}
              </Text>
              <Text dimColor> {command.description}</Text>
            </Text>
            {active ? <Text color={theme.accent}>↵</Text> : null}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · Enter run · Esc close</Text>
      </Box>
    </Box>
  );
}
