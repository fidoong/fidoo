import type { ZodType } from "zod";
import type { VerificationEvidence } from "../domain/messages.js";
import type { TaskPlanUpdate } from "../domain/plan.js";
import type { ArtifactReference, ArtifactStore } from "./artifacts.js";

export type ToolEffect = "read" | "write" | "execute" | "network";
export type ToolRisk = "low" | "medium" | "high";

export interface ToolContext {
  runId: string;
  cwd: string;
  signal: AbortSignal;
  artifacts: ArtifactStore;
}

export interface ToolResult {
  summary: string;
  content: string;
  artifacts?: ArtifactReference[];
  planUpdate?: TaskPlanUpdate;
  success?: boolean;
  changedFiles?: string[];
  verification?: VerificationEvidence;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodType;
  effect: ToolEffect;
  risk: ToolRisk;
  concurrency: "safe" | "exclusive";
  idempotency: "always" | "never" | "reconcile";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

interface TypedToolDefinition<Input, Output extends ToolResult> {
  name: string;
  description: string;
  inputSchema: ZodType<Input>;
  effect: ToolEffect;
  risk: ToolRisk;
  concurrency: "safe" | "exclusive";
  idempotency: "always" | "never" | "reconcile";
  execute(input: Input, context: ToolContext): Promise<Output>;
}

export function defineTool<Input, Output extends ToolResult>(
  definition: TypedToolDefinition<Input, Output>,
): ToolDefinition {
  return {
    ...definition,
    execute: (input, context) => definition.execute(input as Input, context),
  };
}
