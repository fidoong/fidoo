import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AgentApi } from "@fidoo/api";
import { AgentError, errorMessage } from "@fidoo/core";
import type { ApiMethod, JsonRpcError, PublicRunEvent } from "@fidoo/protocol";
import {
  API_METHODS,
  JSON_RPC_VERSION,
  jsonRpcRequestSchema,
  PROTOCOL_VERSION,
  publicRunEventSchema,
  subscriptionCloseNotificationSchema,
} from "@fidoo/protocol";
import { ZodError } from "zod";

interface Subscription {
  iterator: AsyncIterator<unknown>;
}

export class StdioServer {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly activeRequests = new Set<string>();
  private readline: Interface | undefined;
  private closed = false;

  constructor(
    private readonly api: AgentApi,
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout,
  ) {}

  listen(): void {
    this.readline = createInterface({ input: this.input, crlfDelay: Number.POSITIVE_INFINITY });
    this.readline.on("line", (line) => {
      const task = this.handleLine(line).finally(() => this.tasks.delete(task));
      this.tasks.add(task);
    });
    this.readline.on("close", () => {
      void this.closeSubscriptions();
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readline?.close();
    await this.closeSubscriptions();
    await Promise.allSettled([...this.tasks]);
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.send({
        jsonrpc: JSON_RPC_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        requestId: null,
        error: rpcError(-32700, `Parse error: ${errorMessage(error)}`),
      });
      return;
    }

    const close = subscriptionCloseNotificationSchema.safeParse(message);
    if (close.success) {
      await this.closeSubscription(close.data.params.subscriptionId);
      return;
    }

    const requestId = readRequestId(message);
    const parsed = jsonRpcRequestSchema.safeParse(message);
    if (!parsed.success) {
      const version =
        typeof message === "object" && message !== null && "protocolVersion" in message
          ? String(message.protocolVersion)
          : undefined;
      this.send({
        jsonrpc: JSON_RPC_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        error: rpcError(-32600, "Invalid JSON-RPC request", {
          ...(version !== PROTOCOL_VERSION ? { protocolVersion: PROTOCOL_VERSION } : {}),
        }),
      });
      return;
    }
    const request = parsed.data;
    if (this.activeRequests.has(request.requestId)) {
      this.sendError(request.requestId, rpcError(-32600, "Duplicate requestId"));
      return;
    }
    if (request.method === "run.subscribe") {
      this.activeRequests.add(request.requestId);
      try {
        await this.openSubscription(request.requestId, request.params);
      } catch (error) {
        this.sendError(request.requestId, requestError(error));
      } finally {
        this.activeRequests.delete(request.requestId);
      }
      return;
    }
    if (!API_METHODS.includes(request.method as ApiMethod)) {
      this.sendError(request.requestId, rpcError(-32601, `Method not found: ${request.method}`));
      return;
    }
    this.activeRequests.add(request.requestId);
    try {
      const result = await this.api.call(request.method as ApiMethod, request.params ?? {});
      this.send({
        jsonrpc: JSON_RPC_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        result,
      });
    } catch (error) {
      this.sendError(request.requestId, requestError(error));
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  private async openSubscription(requestId: string, params: unknown): Promise<void> {
    const subscriptionId = randomUUID();
    const iterator = this.api.subscribe(params)[Symbol.asyncIterator]();
    this.subscriptions.set(subscriptionId, { iterator });
    this.send({
      jsonrpc: JSON_RPC_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      result: { subscriptionId },
    });
    const task = this.pumpSubscription(subscriptionId, iterator).finally(() =>
      this.tasks.delete(task),
    );
    this.tasks.add(task);
  }

  private async pumpSubscription(
    subscriptionId: string,
    iterator: AsyncIterator<unknown>,
  ): Promise<void> {
    let error: JsonRpcError | undefined;
    try {
      while (!this.closed && this.subscriptions.has(subscriptionId)) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }
        const event: PublicRunEvent = publicRunEventSchema.parse(next.value);
        this.send({
          jsonrpc: JSON_RPC_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          method: "run.event",
          params: { subscriptionId, event },
        });
      }
    } catch (cause) {
      error = requestError(cause);
    } finally {
      this.subscriptions.delete(subscriptionId);
      await iterator.return?.();
      this.send({
        jsonrpc: JSON_RPC_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        method: "run.end",
        params: { subscriptionId, ...(error ? { error } : {}) },
      });
    }
  }

  private async closeSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }
    this.subscriptions.delete(subscriptionId);
    await subscription.iterator.return?.();
  }

  private async closeSubscriptions(): Promise<void> {
    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    await Promise.allSettled(subscriptions.map((subscription) => subscription.iterator.return?.()));
  }

  private sendError(requestId: string, error: JsonRpcError): void {
    this.send({
      jsonrpc: JSON_RPC_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      error,
    });
  }

  private send(message: unknown): void {
    if (!this.output.destroyed) {
      this.output.write(`${JSON.stringify(message)}\n`);
    }
  }
}

function requestError(error: unknown): JsonRpcError {
  if (error instanceof ZodError) {
    return rpcError(-32602, "Invalid params", { agentCode: "validation" });
  }
  if (error instanceof AgentError) {
    return rpcError(-32603, error.message, { agentCode: error.code });
  }
  return rpcError(-32603, errorMessage(error));
}

function rpcError(code: number, message: string, data?: JsonRpcError["data"]): JsonRpcError {
  return { code, message, ...(data ? { data } : {}) };
}

function readRequestId(message: unknown): string | null {
  if (typeof message !== "object" || message === null || !("requestId" in message)) {
    return null;
  }
  return typeof message.requestId === "string" ? message.requestId : null;
}
