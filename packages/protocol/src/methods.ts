import { z } from "zod";

export const workspaceValidateParamsSchema = z.object({ cwd: z.string().min(1) });
export const workspaceValidateResultSchema = z.object({
  path: z.string(),
  valid: z.boolean(),
  error: z.string().optional(),
});
export type WorkspaceValidateParams = z.infer<typeof workspaceValidateParamsSchema>;
export type WorkspaceValidateResult = z.infer<typeof workspaceValidateResultSchema>;

export const runStartParamsSchema = z.object({
  task: z.string().min(1),
  cwd: z.string().min(1),
});
export const runStartResultSchema = z.object({ runId: z.string().min(1) });
export type RunStartParams = z.infer<typeof runStartParamsSchema>;
export type RunStartResult = z.infer<typeof runStartResultSchema>;

export const runResumeParamsSchema = z.object({
  runId: z.string().min(1),
  task: z.string().min(1).optional(),
});
export type RunResumeParams = z.infer<typeof runResumeParamsSchema>;

export const runSteerParamsSchema = z.object({
  runId: z.string().min(1),
  task: z.string().min(1),
});
export type RunSteerParams = z.infer<typeof runSteerParamsSchema>;

export const runIdParamsSchema = z.object({ runId: z.string().min(1) });
export type RunIdParams = z.infer<typeof runIdParamsSchema>;

export const runSubscribeParamsSchema = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().default(0),
});
export type RunSubscribeParams = z.infer<typeof runSubscribeParamsSchema>;

export const runListParamsSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});
export type RunListParams = z.infer<typeof runListParamsSchema>;

export const runStatusSchema = z.enum(["running", "completed", "failed", "blocked", "cancelled"]);
export const runSnapshotSchema = z.object({
  runId: z.string(),
  task: z.string(),
  cwd: z.string(),
  status: runStatusSchema,
  changedFiles: z.array(z.string()),
  verified: z.boolean(),
  finalSummary: z.string().optional(),
  error: z.string().optional(),
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

export const runSummarySchema = z.object({
  runId: z.string(),
  task: z.string(),
  cwd: z.string(),
  status: runStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const approvalRespondParamsSchema = z.object({
  runId: z.string().min(1),
  callId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});
export type ApprovalRespondParams = z.infer<typeof approvalRespondParamsSchema>;

export const apiResultSchema = z.object({ ok: z.literal(true) });

export const artifactReferenceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const artifactReadParamsSchema = z.object({
  runId: z.string().min(1),
  artifactId: z.string().regex(/^[a-f0-9]{8,64}$/),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type ArtifactReadParams = z.input<typeof artifactReadParamsSchema>;

export const artifactPageSchema = artifactReferenceSchema.extend({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  totalLines: z.number().int().nonnegative(),
  content: z.string(),
  nextOffset: z.number().int().nonnegative().optional(),
});
export type ArtifactPage = z.infer<typeof artifactPageSchema>;
