import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AgentTransport, ApiMethod, JsonRpcError } from "@fidoo/protocol";
import {
  JSON_RPC_VERSION,
  jsonRpcResponseSchema,
  PROTOCOL_VERSION,
  runEndNotificationSchema,
  runEventNotificationSchema,
  runSubscribeResultSchema,
} from "@fidoo/protocol";

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
  onResult?(result: unknown): void;
}

export class AgentProtocolError extends Error {
  readonly requestId?: string;
  readonly data?: JsonRpcError["data"];

  constructor(
    message: string,
    readonly code: number,
    options: { requestId?: string; data?: JsonRpcError["data"] } = {},
  ) {
    super(message);
    this.name = "AgentProtocolError";
    if (options.requestId) {
      this.requestId = options.requestId;
    }
    if (options.data) {
      this.data = options.data;
    }
  }
}

export class StdioTransport implements AgentTransport {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, EventQueue>();
  private readonly readline: Interface;
  private nextRequestId = 0;
  private closed = false;
  private closeError: AgentProtocolError | undefined;

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    this.readline = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    input.on("error", (error) => this.abort(error));
    output.on("error", (error) => this.abort(error));
    void this.readMessages();
  }

  call(method: ApiMethod, params: unknown): Promise<unknown> {
    return this.request(method, params);
  }

  subscribe(method: "run.subscribe", params: unknown): AsyncIterable<unknown> {
    const transport = this;
    return {
      async *[Symbol.asyncIterator]() {
        const queue = new EventQueue();
        let subscriptionId: string | undefined;
        try {
          await transport.request(method, params, (result) => {
            subscriptionId = runSubscribeResultSchema.parse(result).subscriptionId;
            transport.subscriptions.set(subscriptionId, queue);
          });
          yield* queue;
        } finally {
          if (subscriptionId) {
            const id = subscriptionId;
            transport.subscriptions.delete(id);
            queue.end();
            transport.notify("subscription.close", { subscriptionId: id });
          }
        }
      },
    };
  }

  close(): void {
    this.abort(new AgentProtocolError("Stdio transport closed", -32000));
    this.readline.close();
    if (!this.output.destroyed) {
      this.output.end();
    }
  }

  abort(cause: unknown): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeError =
      cause instanceof AgentProtocolError
        ? cause
        : new AgentProtocolError(
            `Stdio connection failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            -32000,
          );
    const error = this.closeError;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const queue of this.subscriptions.values()) {
      queue.end(error);
    }
    this.subscriptions.clear();
  }

  private request(
    method: ApiMethod,
    params: unknown,
    onResult?: (result: unknown) => void,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(this.closeError);
    }
    const requestId = `req-${++this.nextRequestId}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, ...(onResult ? { onResult } : {}) });
      try {
        this.write({ requestId, method, params });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  private notify(method: "subscription.close", params: unknown): void {
    if (!this.closed) {
      this.write({ method, params });
    }
  }

  private write(message: { requestId?: string; method: string; params: unknown }): void {
    this.output.write(
      `${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, protocolVersion: PROTOCOL_VERSION, ...message })}\n`,
    );
  }

  private async readMessages(): Promise<void> {
    try {
      for await (const line of this.readline) {
        if (!line.trim()) {
          continue;
        }
        this.handleMessage(line);
        if (this.closed) {
          return;
        }
      }
      if (!this.closed) {
        this.abort(new AgentProtocolError("Agent server closed stdio", -32000));
      }
    } catch (error) {
      this.abort(error);
    }
  }

  private handleMessage(line: string): void {
    const message: unknown = JSON.parse(line);
    const event = runEventNotificationSchema.safeParse(message);
    if (event.success) {
      this.subscriptions.get(event.data.params.subscriptionId)?.push(event.data.params.event);
      return;
    }
    const end = runEndNotificationSchema.safeParse(message);
    if (end.success) {
      const { subscriptionId, error } = end.data.params;
      this.subscriptions.get(subscriptionId)?.end(error ? protocolError(error) : undefined);
      this.subscriptions.delete(subscriptionId);
      return;
    }
    const response = jsonRpcResponseSchema.parse(message);
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    if ("error" in response) {
      pending.reject(protocolError(response.error, response.requestId));
      return;
    }
    try {
      pending.onResult?.(response.result);
      pending.resolve(response.result);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function protocolError(error: JsonRpcError, requestId?: string): AgentProtocolError {
  return new AgentProtocolError(error.message, error.code, {
    ...(requestId ? { requestId } : {}),
    ...(error.data ? { data: error.data } : {}),
  });
}

class EventQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = [];
  private waiting:
    | { resolve(result: IteratorResult<unknown>): void; reject(error: Error): void }
    | undefined;
  private ended = false;
  private error: Error | undefined;

  push(value: unknown): void {
    if (this.ended) {
      return;
    }
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting.resolve({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  end(error?: Error): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.error = error;
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = undefined;
      if (error) {
        waiting.reject(error);
      } else {
        waiting.resolve({ value: undefined, done: true });
      }
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.ended) {
        if (this.error) {
          throw this.error;
        }
        return;
      }
      const next = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
        this.waiting = { resolve, reject };
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}
