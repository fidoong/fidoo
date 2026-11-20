export const API_METHODS = [
  "workspace.validate",
  "run.start",
  "run.resume",
  "run.cancel",
  "run.get",
  "run.subscribe",
  "run.list",
  "run.trace",
  "approval.respond",
] as const;

export type ApiMethod = (typeof API_METHODS)[number];

export interface AgentTransport {
  call(method: ApiMethod, params: unknown): Promise<unknown>;
  subscribe(method: "run.subscribe", params: unknown): AsyncIterable<unknown>;
}
