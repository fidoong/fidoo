import { z } from "zod";
import { defineTool } from "../ports/tool.js";

const stepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().min(1).max(200),
  status: z.enum(["pending", "in_progress", "completed", "blocked", "skipped"]),
  detail: z.string().max(1000).optional(),
  evidence: z.string().max(1000).optional(),
});

const inputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(20)
    .refine((steps) => new Set(steps.map((step) => step.id)).size === steps.length, {
      message: "Plan step ids must be unique",
    })
    .refine((steps) => steps.filter((step) => step.status === "in_progress").length <= 1, {
      message: "At most one plan step can be in progress",
    }),
});

export const updatePlanTool = defineTool({
  name: "update_plan",
  description:
    "Create or replace the visible task plan for a non-trivial task. Preserve stable step ids across updates, keep at most one step in progress, and record concrete evidence when completing a step.",
  inputSchema,
  effect: "read",
  risk: "low",
  concurrency: "safe",
  idempotency: "always",
  execute: async (input) => ({
    summary: `Plan updated: ${input.steps.filter((step) => step.status === "completed").length}/${input.steps.length} steps completed`,
    content: JSON.stringify({ title: input.title, steps: input.steps }),
    planUpdate: {
      ...(input.title ? { title: input.title } : {}),
      steps: input.steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
        ...(step.detail ? { detail: step.detail } : {}),
        ...(step.evidence ? { evidence: step.evidence } : {}),
      })),
    },
  }),
});
