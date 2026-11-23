export type TaskPlanStatus = "pending" | "in_progress" | "completed" | "blocked" | "skipped";

export interface TaskPlanStep {
  id: string;
  title: string;
  status: TaskPlanStatus;
  detail?: string;
  evidence?: string;
}

export interface TaskPlan {
  id: string;
  title: string;
  revision: number;
  steps: TaskPlanStep[];
}

export interface TaskPlanUpdate {
  title?: string;
  steps: TaskPlanStep[];
}
