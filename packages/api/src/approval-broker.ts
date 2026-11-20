import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "@fidoo/core";
import { AgentError } from "@fidoo/core";
import type { ApprovalRespondParams } from "@fidoo/protocol";

interface PendingApproval {
  resolve(decision: ApprovalDecision): void;
}

export class ApprovalBroker implements ApprovalPort {
  private readonly pending = new Map<string, PendingApproval>();

  async approve(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    const key = approvalKey(request.runId, request.call.id);
    if (this.pending.has(key)) {
      throw new AgentError(`Approval already pending: ${key}`, "approval");
    }
    return new Promise<ApprovalDecision>((resolve, reject) => {
      this.pending.set(key, { resolve });
      signal.addEventListener(
        "abort",
        () => {
          if (this.pending.delete(key)) {
            reject(new AgentError("Approval cancelled", "cancelled"));
          }
        },
        { once: true },
      );
    });
  }

  respond(params: ApprovalRespondParams): void {
    const key = approvalKey(params.runId, params.callId);
    const pending = this.pending.get(key);
    if (!pending) {
      throw new AgentError(`No pending approval for ${params.callId}`, "approval");
    }
    this.pending.delete(key);
    pending.resolve({
      approved: params.decision === "approved",
      reason: params.reason ?? `Decision submitted through API: ${params.decision}`,
    });
  }
}

function approvalKey(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}
