import { Box, Text } from "ink";
import type { PendingApproval } from "../../runtime/types.js";
import { theme } from "../../theme/index.js";
import { CommandHighlight } from "../conversation/code.js";
import { formatArguments } from "../conversation/tool-call-card.js";
import { Key } from "../layout/chrome.js";

export function ApprovalDialog({
  approval,
  pendingCount = 1,
}: {
  approval: PendingApproval;
  pendingCount?: number;
}) {
  const danger = approval.risk === "high";
  const args = formatArguments(approval.call.name, approval.call.arguments);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={danger ? theme.error : theme.muted}
      paddingX={1}
    >
      <Text dimColor>{approval.risk} risk</Text>
      <Text bold color={danger ? theme.error : theme.brand}>
        Approval required · {approval.call.name}
        {pendingCount > 1 ? ` · 1/${pendingCount}` : ""}
      </Text>
      <Box marginY={1}>
        {approval.call.name === "bash" ? (
          <CommandHighlight command={args} />
        ) : (
          <Text color={theme.code}>{args}</Text>
        )}
      </Box>
      <Text dimColor>{approval.reason}</Text>
      <Box marginTop={1}>
        <Text>
          <Key primary>y</Key>
          <Text dimColor> approve once · </Text>
          <Key>n / Esc</Key>
          <Text dimColor> reject · </Text>
          <Key>Ctrl+C</Key>
          <Text dimColor> cancel run</Text>
        </Text>
      </Box>
    </Box>
  );
}
