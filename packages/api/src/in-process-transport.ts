import type { AgentTransport, ApiMethod, SubscriptionMethod } from "@fidoo/protocol";
import type { AgentApi } from "./agent-api.js";

export class InProcessTransport implements AgentTransport {
  private nextRequestId = 0;

  constructor(private readonly api: AgentApi) {}

  call(method: ApiMethod, params: unknown): Promise<unknown> {
    return this.api.call(method, params, `in-process-${++this.nextRequestId}`);
  }

  subscribe(method: SubscriptionMethod, params: unknown): AsyncIterable<unknown> {
    return this.api.subscribe(method, params);
  }
}
