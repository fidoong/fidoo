import type { AgentClient } from "@fidoo/client";
import type {
  BackgroundTask,
  BackgroundTaskEvent,
  PublicRunEvent,
  TaskOutputPage,
} from "@fidoo/protocol";

export interface ActivityState {
  tasks: BackgroundTask[];
  scope: "current" | "all";
  connection: "connected" | "reconnecting";
  loading: boolean;
  error?: string | undefined;
}

export class ActivityController {
  private state: ActivityState = {
    tasks: [],
    scope: "current",
    connection: "connected",
    loading: false,
  };
  private readonly listeners = new Set<() => void>();
  private runId: string | undefined;
  private refreshGeneration = 0;
  private subscriptionGeneration = 0;
  private taskSubscription: AsyncIterator<BackgroundTaskEvent> | undefined;
  private disposed = false;

  constructor(private readonly client: AgentClient) {
    this.client.onConnectionChange((connection) => {
      if (connection === "closed") return;
      this.update({ connection });
      if (connection === "connected") {
        void this.refresh();
        void this.consumeTasks();
      }
    });
    void this.refresh();
    void this.consumeTasks();
  }

  getSnapshot = (): ActivityState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setRun(runId: string | undefined): void {
    if (this.runId === runId) return;
    this.runId = runId;
    void this.refresh();
  }

  setScope(scope: ActivityState["scope"]): void {
    if (this.state.scope === scope) return;
    this.update({ scope });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.update({ loading: true, error: undefined });
    try {
      const tasks = await this.client.tasks.list(
        this.state.scope === "current" && this.runId ? { runId: this.runId } : {},
      );
      if (generation === this.refreshGeneration && !this.disposed) {
        this.update({ tasks, loading: false });
      }
    } catch (error) {
      if (generation === this.refreshGeneration && !this.disposed) {
        this.update({ loading: false, error: errorText(error) });
      }
    }
  }

  readOutput(taskId: string, offset = 0, limit = 200): Promise<TaskOutputPage> {
    return this.client.tasks.output({ taskId, offset, limit });
  }

  async stop(task: BackgroundTask): Promise<BackgroundTask> {
    const stopped = await this.client.tasks.stop({
      taskId: task.taskId,
      runId: task.runId,
      confirmed: true,
    });
    await this.refresh();
    return stopped;
  }

  trace(runId: string): Promise<PublicRunEvent[]> {
    return this.client.run.trace({ runId });
  }

  dispose(): void {
    this.disposed = true;
    this.subscriptionGeneration += 1;
    this.refreshGeneration += 1;
    void this.taskSubscription?.return?.().catch(() => undefined);
    this.taskSubscription = undefined;
    this.listeners.clear();
  }

  private async consumeTasks(): Promise<void> {
    const generation = ++this.subscriptionGeneration;
    void this.taskSubscription?.return?.().catch(() => undefined);
    let iterator: AsyncIterator<BackgroundTaskEvent> | undefined;
    try {
      iterator = this.client.tasks.subscribe()[Symbol.asyncIterator]();
      this.taskSubscription = iterator;
      while (!this.disposed && generation === this.subscriptionGeneration) {
        const next = await iterator.next();
        if (next.done) return;
        await this.refresh();
        if (next.value.type === "task.finished") {
          this.update({ error: undefined });
        }
      }
    } catch (error) {
      if (!this.disposed && generation === this.subscriptionGeneration) {
        this.update({ error: `Task subscription disconnected: ${errorText(error)}` });
      }
    } finally {
      if (this.taskSubscription === iterator) this.taskSubscription = undefined;
      void iterator?.return?.().catch(() => undefined);
    }
  }

  private update(update: Partial<ActivityState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
