import { Box, Text } from "ink";
import type { TuiState } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";

export function StatusDialog({
  state,
  provider,
  model,
  cwd,
  contextLimit,
}: {
  state: TuiState;
  provider?: string | undefined;
  model?: string | undefined;
  cwd: string;
  contextLimit: number;
}) {
  const cacheHitRate =
    state.usage.inputTokens > 0 ? state.usage.cacheReadTokens / state.usage.inputTokens : 0;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>Run status</Text>
        <Text dimColor>Esc close</Text>
      </Box>
      <Field label="State" value={state.phase} />
      <Field label="Run" value={state.runId ?? "Not started"} />
      <Field label="Model" value={`${provider ?? "agent"} / ${model ?? "configured"}`} />
      <Field label="Workspace" value={cwd} />
      <Field label="Events" value={String(state.lastSeq)} />
      <Field
        label="Tokens"
        value={`${state.usage.inputTokens} in / ${state.usage.outputTokens} out`}
      />
      <Field
        label="Cache"
        value={`${Math.round(cacheHitRate * 100)}% hit · ${state.usage.cacheReadTokens} read / ${state.usage.cacheWriteTokens} write`}
      />
      <Field label="Context" value={`${state.contextTokens} / ${contextLimit} tokens`} />
      <Field
        label="Model calls"
        value={`${state.modelActivity.calls} completed · ${state.modelActivity.failures} failed · ${Math.round(state.modelActivity.durationMs / 1000)}s total`}
      />
      <Field label="Changes" value={`${state.changedFiles.length} files`} />
      <Field label="Verification" value={state.verificationStatus ?? "not run"} />
      <Field
        label="Plan"
        value={
          state.taskPlan
            ? `${state.taskPlan.title} · r${state.taskPlan.revision}`
            : "No explicit plan"
        }
      />
      <Box marginTop={1}>
        <Text dimColor>Read-only status · /trace for canonical events</Text>
      </Box>
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Text wrap="wrap">
      <Text dimColor>{label.padEnd(12)}</Text>
      <Text>{value}</Text>
    </Text>
  );
}
