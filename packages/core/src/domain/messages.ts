import type { ArtifactReference } from "../ports/artifacts.js";
import type { VerificationEvidence } from "./verification.js";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface UserMessage {
  role: "user";
  content: string;
  source: "user" | "harness";
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolMessage;

export interface ToolObservation {
  callId: string;
  name: string;
  status: "success" | "error";
  summary?: string;
  content: string;
  artifacts?: ArtifactReference[];
  changedFiles?: string[];
  verification?: VerificationEvidence;
}
