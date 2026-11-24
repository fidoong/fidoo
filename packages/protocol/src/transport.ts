export const API_METHODS = [
  "workspace.validate",
  "run.start",
  "run.resume",
  "run.steer",
  "run.cancel",
  "run.get",
  "run.subscribe",
  "run.list",
  "run.trace",
  "artifact.read",
  "settings.get",
  "settings.update",
  "settings.models",
  "approval.respond",
  "task.list",
  "task.output",
  "task.stop",
  "task.subscribe",
] as const;

export type SubscriptionMethod = "run.subscribe" | "task.subscribe";

export type ApiMethod = (typeof API_METHODS)[number];

export type AgentConnectionState = "connected" | "reconnecting" | "closed";

export interface AgentTransport {
  call(method: ApiMethod, params: unknown): Promise<unknown>;
  subscribe(method: SubscriptionMethod, params: unknown): AsyncIterable<unknown>;
  onConnectionChange?(listener: (state: AgentConnectionState) => void): () => void;
}
