import { z } from "zod";

export const userInputOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const userInputQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(userInputOptionSchema).min(2).max(4).optional(),
  multiSelect: z.boolean().optional(),
});

export const inputRespondParamsSchema = z.object({
  runId: z.string().min(1),
  callId: z.string().min(1),
  answers: z.record(z.string(), z.array(z.string().min(1))),
});

export type UserInputOption = z.infer<typeof userInputOptionSchema>;
export type UserInputQuestion = z.infer<typeof userInputQuestionSchema>;
export type InputRespondParams = z.infer<typeof inputRespondParamsSchema>;
