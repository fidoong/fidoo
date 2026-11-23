import type { AgentClient } from "@fidoo/client";
import type {
  ApprovalRespondParams,
  ArtifactPage,
  ProviderModelsParams,
  PublicRunEvent,
  RunSummary,
  SettingsUpdateParams,
} from "@fidoo/protocol";
import {
  appendReasoningText,
  appendStreamingText,
  applyRunEvent,
  initialTuiState,
  isActivePhase,
  markControllerError,
  markStarting,
} from "./store.js";
import type { TuiState } from "./types.js";

export class AgentController {
  private state = initialTuiState();
  private readonly listeners = new Set<() => void>();
  private execution: Promise<void> = Promise.resolve();
  private generation = 0;
  private responding = false;
  private pendingDelta = "";
  private pendingReasoning = "";
  private deltaTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: AgentClient,
    private readonly cwd: string,
  ) {}

  getSnapshot = (): TuiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async submit(task: string): Promise<void> {
    const content = task.trim();
    if (!content || isActivePhase(this.state.phase)) {
      return;
    }
    this.clearDelta();
    const generation = ++this.generation;
    this.update(markStarting(this.state));
    try {
      let afterSeq = this.state.lastSeq;
      if (this.state.runId) {
        await this.client.run.resume({ runId: this.state.runId, task: content });
      } else {
        const started = await this.client.run.start({ task: content, cwd: this.cwd });
        this.state = { ...this.state, runId: started.runId };
        afterSeq = 0;
        this.emit();
      }
      const runId = this.state.runId;
      if (!runId) {
        return;
      }
      this.execution = this.consume(runId, afterSeq, generation);
      await this.execution;
    } catch (error) {
      this.fail(error, generation);
    }
  }

  async respond(decision: ApprovalRespondParams["decision"]): Promise<void> {
    const approval = this.state.pendingApproval;
    if (!approval || this.responding) {
      return;
    }
    this.responding = true;
    try {
      await this.client.approval.respond({
        runId: approval.runId,
        callId: approval.call.id,
        decision,
        reason: decision === "approved" ? "Approved in TUI" : "Rejected in TUI",
      });
    } catch (error) {
      this.fail(error, this.generation);
    } finally {
      this.responding = false;
    }
  }

  async steer(task: string): Promise<void> {
    if (!this.state.runId || !isActivePhase(this.state.phase)) {
      throw new Error("No active run is available for steering");
    }
    await this.client.run.steer({ runId: this.state.runId, task });
    this.update({ ...this.state, notice: "Steering recorded · next model turn" });
  }

  async cancel(): Promise<void> {
    if (!this.state.runId || !isActivePhase(this.state.phase)) {
      return;
    }
    try {
      await this.client.run.cancel({ runId: this.state.runId });
    } catch (error) {
      this.fail(error, this.generation);
    }
  }

  newSession(): void {
    if (isActivePhase(this.state.phase)) {
      return;
    }
    this.clearDelta();
    this.generation += 1;
    this.update(initialTuiState());
  }

  readArtifact(artifactId: string, offset = 0, limit = 200): Promise<ArtifactPage> {
    if (!this.state.runId) {
      throw new Error("Start or restore a run before reading an artifact");
    }
    return this.client.artifacts.read({ runId: this.state.runId, artifactId, offset, limit });
  }

  listSessions(): Promise<RunSummary[]> {
    return this.client.run.list({ limit: 50 });
  }

  getSettings() {
    return this.client.settings.get();
  }

  updateSettings(params: SettingsUpdateParams) {
    return this.client.settings.update(params);
  }

  listModels(params: ProviderModelsParams) {
    return this.client.settings.listModels(params);
  }

  async trace(): Promise<PublicRunEvent[]> {
    if (!this.state.runId) {
      return [];
    }
    return this.client.run.trace({ runId: this.state.runId });
  }

  async loadSession(runId: string): Promise<boolean> {
    if (isActivePhase(this.state.phase)) {
      return false;
    }
    this.clearDelta();
    const generation = ++this.generation;
    this.update(markStarting(initialTuiState()));
    try {
      const [snapshot, events] = await Promise.all([
        this.client.run.get({ runId }),
        this.client.run.trace({ runId }),
      ]);
      if (generation !== this.generation) {
        return false;
      }
      let state = initialTuiState();
      for (const event of events) {
        state = applyRunEvent(state, event);
      }
      if (snapshot.status === "running") {
        state = {
          ...state,
          phase: "idle",
          pendingApproval: undefined,
          notice: "Restored an interrupted run. Submit a message to resume and reconcile it.",
        };
      }
      this.update({ ...state, runId });
      return true;
    } catch (error) {
      this.fail(error, generation);
      return false;
    }
  }

  private async consume(runId: string, afterSeq: number, generation: number): Promise<void> {
    try {
      for await (const event of this.client.run.subscribe({ runId, afterSeq })) {
        if (generation !== this.generation) {
          return;
        }
        if (event.type === "message.assistant.delta") {
          this.queueDelta(String(event.payload.text ?? ""), generation);
        } else if (event.type === "message.reasoning.delta") {
          this.queueReasoning(String(event.payload.text ?? ""), generation);
        } else {
          this.flushDelta(generation);
          this.update(applyRunEvent(this.state, event));
        }
      }
      this.flushDelta(generation);
    } catch (error) {
      this.flushDelta(generation);
      this.fail(error, generation);
    }
  }

  private queueDelta(text: string, generation: number): void {
    this.pendingDelta += text;
    if (!this.deltaTimer) {
      this.deltaTimer = setTimeout(() => this.flushDelta(generation), 50);
    }
  }

  private queueReasoning(text: string, generation: number): void {
    this.pendingReasoning += text;
    if (!this.deltaTimer) {
      this.deltaTimer = setTimeout(() => this.flushDelta(generation), 50);
    }
  }

  private flushDelta(generation: number): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = undefined;
    }
    if (generation !== this.generation) {
      return;
    }
    const text = this.pendingDelta;
    const reasoning = this.pendingReasoning;
    this.pendingDelta = "";
    this.pendingReasoning = "";
    let state = this.state;
    if (text) {
      state = appendStreamingText(state, text);
    }
    if (reasoning) {
      state = appendReasoningText(state, reasoning);
    }
    if (text || reasoning) {
      this.update(state);
    }
  }

  private clearDelta(): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = undefined;
    }
    this.pendingDelta = "";
    this.pendingReasoning = "";
  }

  private fail(error: unknown, generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    this.update(
      markControllerError(this.state, error instanceof Error ? error.message : String(error)),
    );
  }

  private update(state: TuiState): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
