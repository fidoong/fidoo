import type { BackgroundTask } from "@fidoo/protocol";
import { Box, Text } from "ink";
import { theme } from "../../theme/index.js";
import { formatCommand } from "./activity-screen.js";

export function StopTaskDialog({ task, selected }: { task: BackgroundTask; selected: number }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.warning} paddingX={1}>
      <Text bold color={theme.warning}>
        Stop background process?
      </Text>
      <Text>{formatCommand(task)}</Text>
      <Text dimColor>
        PID {task.pid} · {task.taskId.slice(0, 8)} · {task.status}
      </Text>
      <Box marginY={1} columnGap={2}>
        <Text color={selected === 0 ? theme.accent : theme.muted}>
          {selected === 0 ? "› " : "  "}Keep running
        </Text>
        <Text color={selected === 1 ? theme.error : theme.muted}>
          {selected === 1 ? "› " : "  "}Stop process
        </Text>
      </Box>
      <Text dimColor>←→ select · Enter confirm · Esc keep running</Text>
    </Box>
  );
}
