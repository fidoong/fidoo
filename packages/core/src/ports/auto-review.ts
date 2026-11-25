import type { ExecutionObservation } from "../domain/messages.js";
import type { ModelUsage } from "./model.js";
import type { ToolDefinition, ToolRisk } from "./tool.js";

export interface AutoReviewInput {
  task: string;
  tool: ToolDefinition;
  arguments: unknown;
  risk: ToolRisk;
  projectTrusted: boolean;
  sandbox?: ExecutionObservation;
}

export interface AutoReviewResult {
  action: "allow" | "ask" | "deny";
  category: "aligned" | "uncertain" | "unsafe" | "out_of_scope";
  reason: string;
  usage?: ModelUsage;
}

export interface AutoReviewPort {
  review(input: AutoReviewInput, signal: AbortSignal): Promise<AutoReviewResult>;
}
