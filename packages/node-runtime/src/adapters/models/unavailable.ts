import type { ModelEvent, ModelPort } from "@fidoo/core";
import { AgentError } from "@fidoo/core";

export class UnavailableModel implements ModelPort {
  stream(): AsyncIterable<ModelEvent> {
    throw new AgentError("No model is configured. Run /setup in the TUI.", "configuration");
  }
}
