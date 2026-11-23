import type { ArtifactReference, PublicRunEvent } from "@fidoo/protocol";
import { isTerminalRunEvent } from "@fidoo/protocol";
import { persistentEvents } from "./events.js";
import { redact } from "./redact.js";
import type {
  ObservedMessage,
  RunMetrics,
  RunProjection,
  RunStatus,
  TimelineItem,
  TraceSpan,
  TraceSpanStatus,
} from "./types.js";

interface ToolBuilder {
  callId: string;
  name: string;
  startedAt: string;
  startedExecutionAt?: string;
  endedAt?: string;
  status: TraceSpanStatus;
  eventIds: string[];
  approvalStartedAt: string | undefined;
  approvalWaitMs: number;
  arguments: string | undefined;
  result?: unknown;
}

interface ModelBuilder {
  eventId: string;
  iteration: number;
  model: string;
  startedAt: string;
  endedAt?: string;
  status: TraceSpanStatus;
  eventIds: string[];
  detail?: unknown;
}

interface VerificationBuilder {
  attempt: number;
  startedAt: string;
  endedAt?: string;
  status: TraceSpanStatus;
  eventIds: string[];
  detail?: unknown;
}

export function projectRun(runId: string, input: PublicRunEvent[]): RunProjection {
  const events = persistentEvents(input).toSorted((left, right) => left.seq - right.seq);
  const started = events.find((event) => event.type === "run.started");
  const terminal = events.findLast((event) => isTerminalRunEvent(event));
  const tools = new Map<string, ToolBuilder>();
  const models: ModelBuilder[] = [];
  const verifications: VerificationBuilder[] = [];
  const messages: ObservedMessage[] = [];
  const timeline: TimelineItem[] = [];
  const artifacts = new Map<string, ArtifactReference>();
  const changedFiles = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let compactions = 0;
  let latestPlan: unknown;
  let finalSummary: string | undefined;
  let error: string | undefined;

  for (const event of events) {
    const payload = event.payload;
    timeline.push({
      id: event.eventId,
      eventId: event.eventId,
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type,
      label: eventLabel(event),
      detail: redact(payload),
    });

    if (event.type === "message.user" || event.type === "message.assistant") {
      const message = record(payload.message);
      const role = text(message?.role);
      if (role === "user" || role === "assistant") {
        const source = text(message?.source);
        messages.push({
          eventId: event.eventId,
          seq: event.seq,
          timestamp: event.timestamp,
          role,
          content: text(message?.content) ?? "",
          ...(source ? { source } : {}),
        });
      }
    }

    if (event.type === "model.started") {
      models.push({
        eventId: event.eventId,
        iteration: number(payload.iteration),
        model: text(payload.model) ?? "model",
        startedAt: event.timestamp,
        status: "running",
        eventIds: [event.eventId],
        detail: redact(payload),
      });
    } else if (event.type === "model.completed" || event.type === "model.failed") {
      const iteration = number(payload.iteration);
      const model = models.findLast((item) => !item.endedAt && item.iteration === iteration) ?? {
        eventId: event.eventId,
        iteration,
        model: text(payload.model) ?? "model",
        startedAt: event.timestamp,
        status: "running" as const,
        eventIds: [],
      };
      if (!models.includes(model)) models.push(model);
      model.status = event.type === "model.failed" ? "error" : "success";
      model.endedAt = event.timestamp;
      model.eventIds.push(event.eventId);
      model.detail = redact(payload);
    } else if (event.type === "model.usage") {
      inputTokens += number(payload.inputTokens);
      outputTokens += number(payload.outputTokens);
    } else if (event.type === "context.compacted") {
      compactions += 1;
    } else if (event.type === "plan.updated") {
      latestPlan = redact(payload.plan);
    } else if (event.type === "tool.proposed") {
      const call = record(payload.call);
      const callId = text(call?.id);
      if (callId) {
        const tool = ensureTool(tools, callId, event);
        tool.name = text(call?.name) ?? tool.name;
        const arguments_ = text(call?.arguments);
        if (arguments_ !== undefined) {
          tool.arguments = arguments_;
        }
        tool.eventIds.push(event.eventId);
      }
    } else if (event.type === "tool.approval_required") {
      const callId = text(payload.callId);
      if (callId) {
        const tool = ensureTool(tools, callId, event);
        tool.approvalStartedAt = event.timestamp;
        tool.eventIds.push(event.eventId);
      }
    } else if (event.type === "tool.decided") {
      const callId = text(payload.callId);
      if (callId) {
        const tool = ensureTool(tools, callId, event);
        if (tool.approvalStartedAt) {
          tool.approvalWaitMs += elapsed(tool.approvalStartedAt, event.timestamp);
          tool.approvalStartedAt = undefined;
        }
        if (payload.decision === "rejected") {
          tool.status = "rejected";
          tool.endedAt = event.timestamp;
        }
        tool.eventIds.push(event.eventId);
      }
    } else if (event.type === "tool.started") {
      const callId = text(payload.callId);
      if (callId) {
        const tool = ensureTool(tools, callId, event);
        tool.startedExecutionAt = event.timestamp;
        tool.eventIds.push(event.eventId);
      }
    } else if (event.type === "tool.result") {
      const result = record(payload.result);
      const callId = text(result?.callId);
      if (callId) {
        const tool = ensureTool(tools, callId, event);
        tool.name = text(result?.name) ?? tool.name;
        tool.status = result?.status === "error" ? "error" : "success";
        tool.endedAt = event.timestamp;
        tool.result = redact(result);
        tool.eventIds.push(event.eventId);
        for (const path of stringArray(result?.changedFiles)) {
          changedFiles.add(path);
        }
        for (const artifact of artifactReferences(result?.artifacts)) {
          artifacts.set(artifact.id, artifact);
        }
      }
    } else if (event.type === "verification.requested") {
      verifications.push({
        attempt: number(payload.attempt),
        startedAt: event.timestamp,
        status: "running",
        eventIds: [event.eventId],
        detail: redact(payload),
      });
    } else if (event.type === "verification.finished") {
      const verification: VerificationBuilder = verifications.findLast((item) => !item.endedAt) ?? {
        attempt: verifications.length + 1,
        startedAt: event.timestamp,
        status: "running",
        eventIds: [],
      };
      if (!verifications.includes(verification)) {
        verifications.push(verification);
      }
      verification.status = payload.success === true ? "success" : "error";
      verification.endedAt = event.timestamp;
      verification.eventIds.push(event.eventId);
      verification.detail = redact({ request: verification.detail, result: payload });
    } else if (event.type === "run.completed") {
      finalSummary = text(payload.summary);
    } else if (event.type === "run.failed") {
      error = text(payload.error);
    }
  }

  const createdAt = started?.timestamp ?? events[0]?.timestamp ?? new Date(0).toISOString();
  const updatedAt = events.at(-1)?.timestamp ?? createdAt;
  const endedAt = terminal?.timestamp;
  const status = runStatus(terminal);
  const rootSpan: TraceSpan = {
    spanId: `${runId}:run`,
    kind: "run",
    name: text(started?.payload.task) ?? "Agent run",
    status: rootSpanStatus(status),
    startedAt: createdAt,
    ...(endedAt ? { endedAt, durationMs: elapsed(createdAt, endedAt) } : {}),
    eventIds: events
      .filter((event) => event === started || event === terminal || event.type === "run.resumed")
      .map((event) => event.eventId),
  };
  const modelSpans = models.map((model) => modelSpan(runId, model, status));
  const toolSpans = [...tools.values()].map((tool) => toolSpan(runId, tool, status));
  const verificationSpans = verifications.map((verification) =>
    verificationSpan(runId, verification, status),
  );
  const operationSpans = [...modelSpans, ...toolSpans, ...verificationSpans].toSorted(
    (left, right) => left.startedAt.localeCompare(right.startedAt),
  );
  const metrics: RunMetrics = {
    inputTokens,
    outputTokens,
    modelCalls: modelSpans.filter((span) => span.status === "success").length,
    failedModelCalls: modelSpans.filter((span) => span.status === "error").length,
    modelDurationMs: modelSpans.reduce((total, span) => total + (span.durationMs ?? 0), 0),
    toolCalls: tools.size,
    failedTools: toolSpans.filter((span) => span.status === "error").length,
    approvalWaitMs: toolSpans.reduce((total, span) => total + (span.approvalWaitMs ?? 0), 0),
    approvals: events.filter((event) => event.type === "tool.approval_required").length,
    compactions,
    changedFiles: changedFiles.size,
    verified: terminal?.type === "run.completed" && terminal.payload.verification === "passed",
  };

  return {
    runId,
    task: text(started?.payload.task) ?? "Untitled run",
    cwd: text(started?.payload.cwd) ?? "",
    status,
    createdAt,
    updatedAt,
    ...(endedAt ? { durationMs: elapsed(createdAt, endedAt) } : {}),
    lastSeq: events.at(-1)?.seq ?? 0,
    eventCount: events.length,
    metrics,
    spans: [rootSpan, ...operationSpans],
    messages,
    timeline,
    artifacts: [...artifacts.values()],
    ...(latestPlan !== undefined ? { latestPlan } : {}),
    ...(finalSummary !== undefined ? { finalSummary: redact(finalSummary) as string } : {}),
    ...(error !== undefined ? { error: redact(error) as string } : {}),
  };
}

function ensureTool(
  tools: Map<string, ToolBuilder>,
  callId: string,
  event: PublicRunEvent,
): ToolBuilder {
  const existing = tools.get(callId);
  if (existing) {
    return existing;
  }
  const created: ToolBuilder = {
    callId,
    name: "tool",
    startedAt: event.timestamp,
    status: "running",
    eventIds: [],
    approvalStartedAt: undefined,
    approvalWaitMs: 0,
    arguments: undefined,
  };
  tools.set(callId, created);
  return created;
}

function toolSpan(runId: string, tool: ToolBuilder, runStatus: RunStatus): TraceSpan {
  const startedAt = tool.startedExecutionAt ?? tool.startedAt;
  const status = tool.endedAt || runStatus === "running" ? tool.status : "incomplete";
  return {
    spanId: `${runId}:tool:${tool.callId}`,
    parentSpanId: `${runId}:run`,
    kind: "tool",
    name: tool.name,
    status,
    startedAt,
    ...(tool.endedAt
      ? { endedAt: tool.endedAt, durationMs: elapsed(startedAt, tool.endedAt) }
      : {}),
    ...(tool.approvalWaitMs > 0 ? { approvalWaitMs: tool.approvalWaitMs } : {}),
    callId: tool.callId,
    eventIds: tool.eventIds,
    detail: redact({ arguments: tool.arguments, result: tool.result }),
  };
}

function modelSpan(runId: string, model: ModelBuilder, runStatus: RunStatus): TraceSpan {
  return {
    spanId: `${runId}:model:${model.eventId}`,
    parentSpanId: `${runId}:run`,
    kind: "model",
    name: model.model,
    status: model.endedAt || runStatus === "running" ? model.status : "incomplete",
    startedAt: model.startedAt,
    ...(model.endedAt
      ? { endedAt: model.endedAt, durationMs: elapsed(model.startedAt, model.endedAt) }
      : {}),
    eventIds: model.eventIds,
    detail: model.detail,
  };
}

function verificationSpan(
  runId: string,
  verification: VerificationBuilder,
  runStatus: RunStatus,
): TraceSpan {
  return {
    spanId: `${runId}:verification:${verification.attempt}`,
    parentSpanId: `${runId}:run`,
    kind: "verification",
    name: `Verification ${verification.attempt}`,
    status: verification.endedAt || runStatus === "running" ? verification.status : "incomplete",
    startedAt: verification.startedAt,
    ...(verification.endedAt
      ? {
          endedAt: verification.endedAt,
          durationMs: elapsed(verification.startedAt, verification.endedAt),
        }
      : {}),
    eventIds: verification.eventIds,
    detail: verification.detail,
  };
}

function runStatus(terminal: PublicRunEvent | undefined): RunStatus {
  if (terminal?.type === "run.completed") return "completed";
  if (terminal?.type === "run.failed") return "failed";
  if (terminal?.type === "run.blocked") return "blocked";
  if (terminal?.type === "run.cancelled") return "cancelled";
  return "running";
}

function rootSpanStatus(status: RunStatus): TraceSpanStatus {
  if (status === "completed") return "success";
  if (status === "failed" || status === "blocked") return "error";
  if (status === "cancelled") return "incomplete";
  return "running";
}

function eventLabel(event: PublicRunEvent): string {
  const labels: Record<string, string> = {
    "run.started": "Run started",
    "run.resumed": "Run resumed",
    "run.steered": "Run steered",
    "message.user": "User message",
    "message.assistant": "Assistant message",
    "model.started": "Model call started",
    "model.completed": "Model call completed",
    "model.failed": "Model call failed",
    "model.usage": "Model usage",
    "context.compacted": "Context compacted",
    "plan.updated": "Plan updated",
    "verification.requested": "Verification requested",
    "verification.finished": "Verification finished",
    "run.completed": "Run completed",
    "run.failed": "Run failed",
    "run.blocked": "Run blocked",
    "run.cancelled": "Run cancelled",
  };
  return labels[event.type] ?? event.type;
}

function artifactReferences(value: unknown): ArtifactReference[] {
  if (!Array.isArray(value)) return [];
  const artifacts: ArtifactReference[] = [];
  for (const item of value) {
    const artifact = record(item);
    const id = text(artifact?.id);
    const name = text(artifact?.name);
    const bytes = number(artifact?.bytes);
    if (id && name) artifacts.push({ id, name, bytes });
  }
  return artifacts;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function elapsed(startedAt: string, endedAt: string): number {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}
