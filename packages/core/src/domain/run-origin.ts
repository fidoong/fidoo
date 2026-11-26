export interface RunOrigin {
  kind: "root" | "subagent";
  parentRunId?: string;
  parentCallId?: string;
  agentType?: "explore";
  title?: string;
}
