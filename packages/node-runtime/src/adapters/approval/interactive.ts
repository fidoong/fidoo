import { createInterface } from "node:readline/promises";
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "@fidoo/core";

export class InteractiveApproval implements ApprovalPort {
  async approve(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      return {
        approved: false,
        reason:
          "Approval requires an interactive terminal; rerun with --mode acceptEdits for workspace edits",
      };
    }
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    const cancel = () => readline.close();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const answer = await readline.question(
        `\nApprove ${request.risk}-risk ${request.call.name}?\n${request.reason}\n${request.call.arguments}\n[y/N] `,
      );
      const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
      return {
        approved,
        reason: approved ? "Approved by user" : "Rejected by user",
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      readline.close();
    }
  }
}
