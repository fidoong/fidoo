import { z } from "zod";
import { AgentError } from "../domain/errors.js";
import { defineTool } from "../ports/tool.js";

export const requestUserInputTool = defineTool({
  name: "request_user_input",
  description:
    "Ask the user structured questions when a requirement or implementation choice is genuinely ambiguous. Use concise options when choices are known; do not use this for tool permission approvals.",
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
          question: z.string().min(1),
          options: z
            .array(
              z.object({
                id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
                label: z.string().min(1),
                description: z.string().optional(),
              }),
            )
            .min(2)
            .max(4)
            .optional(),
          multiSelect: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(4),
  }),
  effect: "read",
  risk: "low",
  concurrency: "exclusive",
  idempotency: "never",
  interaction: "user-input",
  execute: async (input, context) => {
    if (!context.userInput) {
      throw new AgentError("User input is unavailable in this environment", "configuration");
    }
    const questions = input.questions.map((question) => ({
      id: question.id,
      question: question.question,
      multiSelect: question.multiSelect,
      ...(question.options
        ? {
            options: question.options.map((option) => ({
              id: option.id,
              label: option.label,
              ...(option.description !== undefined ? { description: option.description } : {}),
            })),
          }
        : {}),
    }));
    const response = await context.userInput.ask(
      { runId: context.runId, callId: context.callId, questions },
      context.signal,
    );
    return {
      summary: `Received answers for ${input.questions.length} questions`,
      content: JSON.stringify(response),
    };
  },
});
