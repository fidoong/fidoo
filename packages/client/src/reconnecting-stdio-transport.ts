import type {
  AgentConnectionState,
  AgentTransport,
  ApiMethod,
  PublicRunEvent,
  SubscriptionMethod,
} from "@fidoo/protocol";
import {
  isTransientRunEvent,
  publicRunEventSchema,
  runSnapshotSchema,
  runSubscribeParamsSchema,
} from "@fidoo/protocol";
import { AgentProtocolError, type StdioTransport } from "./stdio-transport.js";

export class ReconnectingStdioTransport implements AgentTransport {
  private current: StdioTransport | undefined;
  private reconnecting: Promise<StdioTransport> | undefined;
  private readonly listeners = new Set<(state: AgentConnectionState) => void>();
  private reconnectAttempt = 0;
  private nextRequestId = 0;
  private generation = 0;
  private readonly recoveries = new Map<string, { generation: number; promise: Promise<void> }>();
  private readonly recovered = new Map<string, number>();
  private closed = false;

  constructor(
    current: StdioTransport,
    private readonly connect: () => StdioTransport,
  ) {
    this.current = current;
  }

  onConnectionChange(listener: (state: AgentConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    const requestId = `client-${++this.nextRequestId}`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let transport: StdioTransport;
      try {
        transport = await this.getTransport();
      } catch (error) {
        if (attempt === 3 || this.closed) throw error;
        continue;
      }
      try {
        return await transport.call(method, params, requestId);
      } catch (error) {
        if (!isDisconnect(error) || attempt === 3 || this.closed) throw error;
        this.disconnect(transport, error);
      }
    }
    throw new AgentProtocolError("Stdio reconnect exhausted", -32000);
  }

  subscribe(method: SubscriptionMethod, params: unknown): AsyncIterable<unknown> {
    if (method === "task.subscribe") return this.subscribeTasks();
    const input = runSubscribeParamsSchema.parse(params);
    const transport = this;
    return {
      async *[Symbol.asyncIterator]() {
        let afterSeq = input.afterSeq;
        let restored = false;
        let consuming = true;
        try {
          while (consuming && !transport.closed) {
            let connection: StdioTransport;
            try {
              connection = await transport.getTransport();
            } catch {
              continue;
            }
            try {
              if (restored) {
                await transport.recover(connection, input.runId);
              }
              for await (const value of connection.subscribe("run.subscribe", {
                runId: input.runId,
                afterSeq,
              })) {
                const event: PublicRunEvent = publicRunEventSchema.parse(value);
                if (!isTransientRunEvent(event)) {
                  afterSeq = Math.max(afterSeq, event.seq);
                }
                yield event;
              }
              return;
            } catch (error) {
              if (!consuming || transport.closed) return;
              if (!isDisconnect(error)) throw error;
              transport.disconnect(connection, error);
              restored = true;
            }
          }
        } finally {
          consuming = false;
        }
      },
    };
  }

  disconnect(transport: StdioTransport, cause: unknown): void {
    if (this.current !== transport) return;
    this.current = undefined;
    transport.abort(cause);
    if (!this.closed) this.emit("reconnecting");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.current?.close();
    this.current = undefined;
    this.emit("closed");
  }

  private subscribeTasks(): AsyncIterable<unknown> {
    const transport = this;
    return {
      async *[Symbol.asyncIterator]() {
        let consuming = true;
        try {
          while (consuming && !transport.closed) {
            let connection: StdioTransport;
            try {
              connection = await transport.getTransport();
            } catch {
              continue;
            }
            try {
              for await (const event of connection.subscribe("task.subscribe", {})) {
                yield event;
              }
              return;
            } catch (error) {
              if (!consuming || transport.closed) return;
              if (!isDisconnect(error)) throw error;
              transport.disconnect(connection, error);
            }
          }
        } finally {
          consuming = false;
        }
      },
    };
  }

  private recover(connection: StdioTransport, runId: string): Promise<void> {
    if (this.recovered.get(runId) === this.generation) return Promise.resolve();
    const existing = this.recoveries.get(runId);
    if (existing?.generation === this.generation) return existing.promise;
    const generation = this.generation;
    const promise = (async () => {
      const snapshot = runSnapshotSchema.parse(
        await connection.call("run.get", { runId }, this.requestId()),
      );
      if (snapshot.status === "running") {
        await connection.call("run.resume", { runId }, this.requestId());
      }
      this.recovered.set(runId, generation);
    })();
    this.recoveries.set(runId, { generation, promise });
    const cleanup = () => {
      if (this.recoveries.get(runId)?.promise === promise) this.recoveries.delete(runId);
    };
    void promise.then(cleanup, cleanup);
    return promise;
  }

  private requestId(): string {
    return `client-${++this.nextRequestId}`;
  }

  private async getTransport(): Promise<StdioTransport> {
    if (this.closed) throw new AgentProtocolError("Stdio transport closed", -32000);
    if (this.current) return this.current;
    if (!this.reconnecting) {
      this.reconnecting = this.reconnect();
    }
    return this.reconnecting;
  }

  private async reconnect(): Promise<StdioTransport> {
    const delay = Math.min(2000, 50 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    await sleep(delay);
    try {
      if (this.closed) throw new AgentProtocolError("Stdio transport closed", -32000);
      const transport = this.connect();
      this.current = transport;
      this.generation += 1;
      this.reconnectAttempt = 0;
      this.emit("connected");
      return transport;
    } finally {
      this.reconnecting = undefined;
    }
  }

  private emit(state: AgentConnectionState): void {
    for (const listener of this.listeners) listener(state);
  }
}

function isDisconnect(error: unknown): boolean {
  return error instanceof AgentProtocolError && error.code === -32000;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
