import { z } from "zod";
import { AgentError } from "../domain/errors.js";
import { defineTool } from "../ports/tool.js";

export const delegateTaskTool = defineTool({
  name: "delegate_task",
  description:
    "Delegate a focused read-only research or code-exploration task to an isolated subagent. The subagent receives a separate runId and context, cannot write files, execute commands or create nested agents, and returns its findings to the parent.",
  inputSchema: z.object({ task: z.string().min(1).max(12000) }),
  effect: "read",
  risk: "medium",
  concurrency: "safe",
  idempotency: "never",
  execute: async (input, context) => {
    if (!context.subagents) {
      throw new AgentError("Subagents are unavailable in this environment", "configuration");
    }
    const result = await context.subagents.run({
      parentRunId: context.runId,
      task: input.task,
      cwd: context.cwd,
      signal: context.signal,
    });
    return {
      summary: `Subagent ${result.status}: ${result.summary}`,
      content: JSON.stringify(result),
      success: result.status === "completed",
    };
  },
});
