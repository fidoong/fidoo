import { defineTool } from "@fidoo/core";
import { z } from "zod";

const inputSchema = z.object({
  reason: z.string().min(1).describe("Concrete blocker and what the user must provide or change"),
});

export const reportBlockedTool = defineTool({
  name: "report_blocked",
  description:
    "End the run as blocked only when the task cannot proceed without user action or an external change. Do not use it for errors you can still diagnose or fix. Do not use it for an empty workspace before verifying the configured path.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "exclusive",
  idempotency: "always",
  execute: async (input) => ({
    summary: `Blocked: ${input.reason}`,
    content: input.reason,
  }),
});
