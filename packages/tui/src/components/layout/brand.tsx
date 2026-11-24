import { Box, Text } from "ink";
import { theme } from "../../theme/index.js";
import { Rule } from "./chrome.js";

export function BrandHeader({
  provider,
  model,
}: {
  provider: string | undefined;
  model: string | undefined;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.brand}>
          ƒ fidoo
        </Text>
        <Text dimColor>
          {provider ?? "agent"} / {model ?? "configured"}
        </Text>
      </Box>
      <Rule />
    </Box>
  );
}

export function Welcome({ cwd }: { cwd: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>What will you build?</Text>
      <Text dimColor>Describe the outcome. Fidoo will inspect, change, and verify.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Start a task</Text>
        <Text>
          <Text color={theme.accent}>01 </Text>Fix a failing test and verify it
        </Text>
        <Text>
          <Text color={theme.accent}>02 </Text>Explain this repository&apos;s architecture
        </Text>
        <Text>
          <Text color={theme.accent}>03 </Text>Review the current changes for regressions
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text wrap="wrap">
          <Text dimColor>Workspace </Text>
          <Text>{cwd}</Text>
        </Text>
        <Text dimColor>
          Local session · approval for sensitive actions · verification after changes
        </Text>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>/ commands · /theme appearance</Text>
        <Text dimColor>Ctrl+K command palette</Text>
      </Box>
    </Box>
  );
}
