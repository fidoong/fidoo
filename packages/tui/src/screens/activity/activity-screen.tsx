import type { BackgroundTask } from "@fidoo/protocol";
import { Box, Text } from "ink";
import { useTerminalColumns } from "../../components/layout/chrome.js";
import { moveSelection, selectionWindow } from "../../navigation/navigation.js";
import type { SubagentCard } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";

export type ActivityTab = "agents" | "processes";

export function ActivityScreen({
  agents,
  tasks,
  tab,
  selected,
  scope,
  loading,
  error,
}: {
  agents: SubagentCard[];
  tasks: BackgroundTask[];
  tab: ActivityTab;
  selected: number;
  scope: "current" | "all";
  loading: boolean;
  error?: string | undefined;
}) {
  const wide = useTerminalColumns() >= 100;
  const items = tab === "agents" ? agents : tasks;
  const active = items.length === 0 ? 0 : Math.min(selected, items.length - 1);
  const { start, end } = selectionWindow(active, items.length, 10);
  const visible = items.slice(start, end);
  const selectedAgent = tab === "agents" ? agents[active] : undefined;
  const selectedTask = tab === "processes" ? tasks[active] : undefined;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={theme.brand}>
          Activity
        </Text>
        <Text dimColor>
          {scope} · {items.length} items
        </Text>
      </Box>
      <Box marginY={1}>
        <Text color={tab === "agents" ? theme.accent : theme.muted}>
          {tab === "agents" ? "› " : "  "}Agents ({agents.length})
        </Text>
        <Text dimColor> </Text>
        <Text color={tab === "processes" ? theme.accent : theme.muted}>
          {tab === "processes" ? "› " : "  "}Processes ({tasks.length})
        </Text>
      </Box>
      <Box flexDirection={wide ? "row" : "column"} columnGap={2}>
        <Box flexDirection="column" flexGrow={1} flexBasis={0}>
          {visible.length === 0 ? <Text dimColor>No activities in this view.</Text> : null}
          {visible.map((item, index) => {
            const position = start + index;
            const activeRow = position === active;
            const agent = tab === "agents" ? (item as SubagentCard) : undefined;
            const task = tab === "processes" ? (item as BackgroundTask) : undefined;
            const status = item.status;
            const title = agent ? agent.task : task ? formatCommand(task) : "";
            return (
              <Text key={agent?.callId ?? task?.taskId} wrap="truncate-end">
                <Text color={activeRow ? theme.accent : statusColor(status)}>
                  {activeRow ? "›" : " "} {statusIcon(status)}
                </Text>
                <Text bold={activeRow}> {short(title, wide ? 42 : 68)} </Text>
                <Text dimColor>{status}</Text>
              </Text>
            );
          })}
          {items.length > visible.length ? (
            <Text dimColor>
              … {start + 1}–{end} / {items.length}
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexBasis={0} marginTop={wide ? 0 : 1}>
          {selectedAgent ? <AgentSummary agent={selectedAgent} /> : null}
          {selectedTask ? <TaskSummary task={selectedTask} /> : null}
        </Box>
      </Box>
      {loading ? <Text dimColor>Refreshing…</Text> : null}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select · ←→ tabs · Enter details · a scope{tab === "processes" ? " · s stop" : ""} ·
          Esc close
        </Text>
      </Box>
    </Box>
  );
}

export function activitySelection(selected: number, length: number, direction: -1 | 1): number {
  return moveSelection(selected, length, direction);
}

function AgentSummary({ agent }: { agent: SubagentCard }) {
  return (
    <>
      <Text bold>Read-only explore agent</Text>
      <Text dimColor>
        run {agent.runId.slice(0, 8)} · call {agent.callId.slice(0, 8)}
      </Text>
      <Text wrap="wrap">{agent.task}</Text>
      {agent.summary ? (
        <Text color={theme.muted} wrap="wrap">
          {short(agent.summary, 240)}
        </Text>
      ) : null}
      {agent.error ? <Text color={theme.error}>{agent.error}</Text> : null}
      <Text dimColor>Enter open event timeline</Text>
    </>
  );
}

function TaskSummary({ task }: { task: BackgroundTask }) {
  return (
    <>
      <Text bold>{formatCommand(task)}</Text>
      <Text dimColor>
        task {task.taskId.slice(0, 8)} · run {task.runId.slice(0, 8)}
      </Text>
      <Text dimColor>
        PID {task.pid} · {task.status}
      </Text>
      <Text dimColor wrap="wrap">
        {task.cwd}
      </Text>
      {task.exitCode !== undefined ? <Text>Exit code {task.exitCode}</Text> : null}
      {task.error ? <Text color={theme.error}>{task.error}</Text> : null}
      <Text dimColor>Enter live output{task.status === "running" ? " · s request stop" : ""}</Text>
    </>
  );
}

export function formatCommand(task: BackgroundTask): string {
  return [task.command, ...task.args].join(" ");
}

function short(value: string, length: number): string {
  const line = value.replaceAll("\n", " ");
  return line.length > length ? `${line.slice(0, Math.max(1, length - 1))}…` : line;
}

function statusIcon(status: string): string {
  if (status === "running") return "●";
  if (status === "completed" || status === "exited" || status === "stopped") return "✓";
  return "×";
}

function statusColor(status: string): string {
  if (status === "running") return theme.warning;
  if (status === "completed" || status === "exited" || status === "stopped") return theme.success;
  return theme.error;
}
