import { Box, Text } from "ink";
import { THEME_PRESET_IDS, THEME_PRESETS, type ThemePresetId, theme } from "../../theme/index.js";

export function ThemeDialog({ selected, current }: { selected: number; current: ThemePresetId }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>Appearance</Text>
        <Text dimColor>~/.fidoo/tui.json</Text>
      </Box>
      {THEME_PRESET_IDS.map((id, index) => {
        const preset = THEME_PRESETS[id];
        const active = index === selected;
        return (
          <Box key={id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={active ? theme.accent : theme.muted}>{active ? "› " : "  "}</Text>
              <Text bold={active} color={active ? theme.accent : theme.brand}>
                {preset.name.padEnd(12)}
              </Text>
              <Text color={preset.colors.accent}>■ </Text>
              <Text color={preset.colors.brand}>■ </Text>
              <Text color={preset.colors.muted}>■</Text>
              {id === current ? <Text dimColor> current</Text> : null}
            </Text>
            <Text dimColor> {preset.description}</Text>
          </Box>
        );
      })}
      <Text dimColor>↑/↓ navigate · Enter apply and save · Esc close</Text>
    </Box>
  );
}
