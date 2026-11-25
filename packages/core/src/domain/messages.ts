import type { ArtifactReference } from "../ports/artifacts.js";
import type { VerificationEvidence } from "./verification.js";

export interface ExecutionObservation {
  backend: "direct" | "seatbelt" | "bubblewrap";
  network: "deny" | "allow" | "unchanged";
  environment: "isolated";
  warning?: string;
}

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

export interface ImageReference {
  artifactId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;
  bytes: number;
  data?: string;
}

export interface ImageContent extends ImageReference {
  data: string;
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
  images?: ImageReference[];
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
  verifications?: VerificationEvidence[];
  images?: ImageReference[];
  execution?: ExecutionObservation;
}
