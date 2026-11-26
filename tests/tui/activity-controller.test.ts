import { createAgentClient } from "@fidoo/client";
import type {
  AgentConnectionState,
  AgentTransport,
  ApiMethod,
  SubscriptionMethod,
} from "@fidoo/protocol";
import { ActivityController } from "@fidoo/tui";
import { describe, expect, it, vi } from "vitest";

describe("ActivityController", () => {
  it("filters tasks and replaces stale subscriptions after reconnecting", async () => {
    const transport = new ActivityTransport();
    const controller = new ActivityController(createAgentClient(transport));
    await vi.waitFor(() => expect(transport.subscriptions).toBe(1));

    controller.setRun("run-1");
    await vi.waitFor(() => expect(transport.listParams.at(-1)).toEqual({ runId: "run-1" }));
    controller.setScope("all");
    await vi.waitFor(() => expect(transport.listParams.at(-1)).toEqual({}));

    transport.connection("reconnecting");
    expect(controller.getSnapshot().connection).toBe("reconnecting");
    transport.connection("connected");
    await vi.waitFor(() => expect(transport.subscriptions).toBe(2));
    await vi.waitFor(() => expect(transport.closedSubscriptions).toBe(1));
    expect(controller.getSnapshot().connection).toBe("connected");

    controller.dispose();
    await vi.waitFor(() => expect(transport.closedSubscriptions).toBe(2));
  });
});

class ActivityTransport implements AgentTransport {
  readonly listParams: unknown[] = [];
  subscriptions = 0;
  closedSubscriptions = 0;
  connection: (state: AgentConnectionState) => void = () => undefined;

  async call(method: ApiMethod, params: unknown): Promise<unknown> {
    if (method === "task.list") {
      this.listParams.push(params);
      return [];
    }
    throw new Error(`Unexpected call: ${method}`);
  }

  subscribe(method: SubscriptionMethod, _params: unknown): AsyncIterable<unknown> {
    if (method !== "task.subscribe") throw new Error(`Unexpected subscription: ${method}`);
    this.subscriptions += 1;
    return {
      [Symbol.asyncIterator]: () => {
        let pending: ((result: IteratorResult<unknown>) => void) | undefined;
        let closed = false;
        return {
          next: () =>
            new Promise<IteratorResult<unknown>>((resolve) => {
              pending = resolve;
            }),
          return: async () => {
            if (!closed) {
              closed = true;
              this.closedSubscriptions += 1;
            }
            pending?.({ value: undefined, done: true });
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  onConnectionChange(listener: (state: AgentConnectionState) => void): () => void {
    this.connection = listener;
    return () => {
      this.connection = () => undefined;
    };
  }
}
