import type { AgentEvent } from "../domain/events.js";
import type { RunOrigin } from "../domain/run-origin.js";
import type { RunStatus } from "../domain/run-state.js";

export interface RunSummary {
  runId: string;
  task: string;
  cwd: string;
  status: RunStatus;
  origin?: RunOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface EventStore {
  append(event: AgentEvent): Promise<void>;
  load(runId: string): Promise<AgentEvent[]>;
  list(): Promise<RunSummary[]>;
}
