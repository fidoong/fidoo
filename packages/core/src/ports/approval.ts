import type { ToolCall } from "../domain/messages.js";
import type { ToolRisk } from "./tool.js";

export interface ApprovalRequest {
  runId: string;
  call: ToolCall;
  risk: ToolRisk;
  reason: string;
}

export interface ApprovalDecision {
  approved: boolean;
  reason: string;
}

export interface ApprovalPort {
  approve(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}
