import { defineTool } from "@fidoo/core";
import { z } from "zod";
import type { BackgroundTaskManager } from "../tasks/background-task-manager.js";

export function createTaskTools(tasks: BackgroundTaskManager) {
  return [
    defineTool({
      name: "task_list",
      description:
        "List background commands started by this run, including their status and exit codes.",
      inputSchema: z.object({}),
      effect: "read",
      risk: "low",
      concurrency: "safe",
      idempotency: "always",
      execute: async (_input, context) => {
        const items = await tasks.list(context.runId);
        return {
          summary: `${items.length} background ${items.length === 1 ? "task" : "tasks"}`,
          content: JSON.stringify(items),
        };
      },
    }),
    defineTool({
      name: "task_output",
      description: "Read a page of output from a background task started by this run.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      effect: "read",
      risk: "low",
      concurrency: "safe",
      idempotency: "always",
      execute: async (input, context) => {
        const task = await tasks.get(input.taskId);
        if (task.runId !== context.runId) {
          return {
            summary: "Background task is not owned by this run",
            content: "Access denied",
            success: false,
          };
        }
        const page = await tasks.readOutput(input.taskId, input.offset, input.limit);
        return {
          summary: `Read output for ${input.taskId}`,
          content: JSON.stringify(page),
        };
      },
    }),
    defineTool({
      name: "task_stop",
      description: "Stop a running background task and its process group.",
      inputSchema: z.object({ taskId: z.string().min(1) }),
      effect: "execute",
      risk: "high",
      concurrency: "exclusive",
      idempotency: "reconcile",
      execute: async (input, context) => {
        const current = await tasks.get(input.taskId);
        if (current.runId !== context.runId) {
          return {
            summary: "Background task is not owned by this run",
            content: "Access denied",
            success: false,
          };
        }
        const task = await tasks.stop(input.taskId);
        return {
          summary: `${task.status}: ${task.taskId}`,
          content: JSON.stringify(task),
          success: task.status === "stopped" || task.status === "exited",
        };
      },
    }),
  ];
}
