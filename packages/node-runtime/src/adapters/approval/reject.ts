import type { ApprovalDecision, ApprovalPort } from "@fidoo/core";

export class RejectApproval implements ApprovalPort {
  async approve(): Promise<ApprovalDecision> {
    return { approved: false, reason: "Approval is unavailable in non-interactive mode" };
  }
}
