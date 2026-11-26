import type { AgentEvent, EventStore, RunSummary } from "@fidoo/core";
import { AgentError } from "@fidoo/core";

export class MemoryEventStore implements EventStore {
  private readonly runs = new Map<string, AgentEvent[]>();

  async append(event: AgentEvent): Promise<void> {
    const events = this.runs.get(event.runId) ?? [];
    if (event.seq !== events.length + 1) {
      throw new AgentError(
        `Invalid event sequence for ${event.runId}: expected ${events.length + 1}, received ${event.seq}`,
        "storage",
      );
    }
    if (events.some((existing) => existing.eventId === event.eventId)) {
      throw new AgentError(`Duplicate event id: ${event.eventId}`, "storage");
    }
    events.push(structuredClone(event));
    this.runs.set(event.runId, events);
  }

  async load(runId: string): Promise<AgentEvent[]> {
    const events = this.runs.get(runId);
    if (!events) {
      throw new AgentError(`Run not found: ${runId}`, "storage");
    }
    return structuredClone(events);
  }

  async list(): Promise<RunSummary[]> {
    const summaries: RunSummary[] = [];
    for (const events of this.runs.values()) {
      const started = events.find((event) => event.type === "run.started");
      const last = events.at(-1);
      if (!started || !last) {
        continue;
      }
      summaries.push({
        runId: started.runId,
        task: started.payload.task,
        cwd: started.payload.cwd,
        ...(started.payload.origin ? { origin: started.payload.origin } : {}),
        status:
          last.type === "run.completed"
            ? "completed"
            : last.type === "run.failed"
              ? "failed"
              : last.type === "run.blocked"
                ? "blocked"
                : last.type === "run.cancelled"
                  ? "cancelled"
                  : "running",
        createdAt: started.timestamp,
        updatedAt: last.timestamp,
      });
    }
    return summaries;
  }
}
