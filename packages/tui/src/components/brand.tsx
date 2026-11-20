import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { Rule, useTerminalColumns } from "./chrome.js";

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
  const columns = useTerminalColumns();
  const compact = columns < 72;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold>What will you build?</Text>
        <Text dimColor>Describe the outcome. Fidoo will inspect, change, and verify.</Text>
      </Box>
      <Box flexDirection={compact ? "column" : "row"}>
        <Box
          width={compact ? "100%" : "58%"}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
          marginRight={compact ? 0 : 1}
        >
          <Text bold>Start a task</Text>
          <Text dimColor>Choose an idea or write your own below.</Text>
          <Box marginTop={1} flexDirection="column">
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
        </Box>
        <Box
          flexGrow={1}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
          marginTop={compact ? 1 : 0}
        >
          <Text bold>Workspace</Text>
          <Text wrap="wrap">{cwd}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Local session</Text>
            <Text dimColor>Approval before sensitive actions</Text>
            <Text dimColor>Verification after changes</Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text dimColor>/ commands · /theme appearance</Text>
        <Text dimColor>Ctrl+K command palette</Text>
      </Box>
    </Box>
  );
}
