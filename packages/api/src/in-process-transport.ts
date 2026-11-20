import type { AgentTransport, ApiMethod } from "@fidoo/protocol";
import type { AgentApi } from "./agent-api.js";

export class InProcessTransport implements AgentTransport {
  constructor(private readonly api: AgentApi) {}

  call(method: ApiMethod, params: unknown): Promise<unknown> {
    return this.api.call(method, params);
  }

  subscribe(_method: "run.subscribe", params: unknown): AsyncIterable<unknown> {
    return this.api.subscribe(params);
  }
}
