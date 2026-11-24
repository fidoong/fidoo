import { z } from "zod";

export const backgroundTaskStatusSchema = z.enum(["running", "exited", "failed", "stopped"]);
export type BackgroundTaskStatus = z.infer<typeof backgroundTaskStatusSchema>;

export const backgroundTaskSchema = z.object({
  taskId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  runId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  pid: z.number().int().positive(),
  status: backgroundTaskStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type BackgroundTask = z.infer<typeof backgroundTaskSchema>;

export const backgroundTaskEventSchema = z.object({
  type: z.enum(["task.started", "task.finished"]),
  task: backgroundTaskSchema,
});
export type BackgroundTaskEvent = z.infer<typeof backgroundTaskEventSchema>;

export const taskListParamsSchema = z.object({ runId: z.string().min(1).optional() });
export type TaskListParams = z.infer<typeof taskListParamsSchema>;

export const taskOutputParamsSchema = z.object({
  taskId: z.string().min(1),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type TaskOutputParams = z.input<typeof taskOutputParamsSchema>;

export const taskOutputPageSchema = z.object({
  taskId: z.string(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  totalLines: z.number().int().nonnegative(),
  content: z.string(),
  nextOffset: z.number().int().nonnegative().optional(),
});
export type TaskOutputPage = z.infer<typeof taskOutputPageSchema>;

export const taskStopParamsSchema = z.object({ taskId: z.string().min(1) });
export type TaskStopParams = z.infer<typeof taskStopParamsSchema>;
