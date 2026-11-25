import { randomUUID } from "node:crypto";
import type { SubagentPort, SubagentRequest, SubagentResult } from "@fidoo/core";
import { RunService, type RunServiceOptions } from "@fidoo/core";

export class RunServiceSubagent implements SubagentPort {
  constructor(private readonly options: RunServiceOptions) {}

  async run(request: SubagentRequest): Promise<SubagentResult> {
    const runId = randomUUID();
    const service = new RunService(this.options);
    const state = await service.start(request.task, request.cwd, request.signal, runId);
    const status =
      state.status === "running" || state.status === "awaiting_plan" ? "failed" : state.status;
    return {
      runId,
      status,
      summary: state.finalSummary ?? state.error ?? "Subagent finished without a summary",
      ...(state.error ? { error: state.error } : {}),
    };
  }
}
