import type { PublicRunEvent } from "@fidoo/protocol";
import type {
  PendingApproval,
  ToolCard,
  TuiState,
  ViewMessage,
  ViewTaskPlan,
  ViewToolCall,
} from "./types.js";

export function initialTuiState(): TuiState {
  return {
    phase: "idle",
    runId: undefined,
    messages: [],
    streamingText: "",
    streamingBlocksStarted: false,
    responseActive: false,
    responseStartIndex: undefined,
    reasoningText: "",
    reasoningActive: false,
    reasoningStartedAt: undefined,
    reasoningEndedAt: undefined,
    reasoningMessageId: undefined,
    tools: [],
    taskPlan: undefined,
    pendingApproval: undefined,
    changedFiles: [],
    verificationStatus: undefined,
    usage: { inputTokens: 0, outputTokens: 0 },
    contextTokens: 0,
    modelActivity: {
      active: false,
      calls: 0,
      durationMs: 0,
      failures: 0,
      iteration: 0,
      startedAt: undefined,
    },
    steeringPending: 0,
    lastSeq: 0,
    notice: undefined,
    error: undefined,
  };
}

export function isActivePhase(phase: TuiState["phase"]): boolean {
  return phase === "starting" || phase === "running" || phase === "awaiting_approval";
}

export function markStarting(state: TuiState): TuiState {
  return {
    ...state,
    phase: "starting",
    streamingText: "",
    streamingBlocksStarted: false,
    responseActive: false,
    responseStartIndex: undefined,
    reasoningText: "",
    reasoningActive: false,
    reasoningStartedAt: undefined,
    reasoningEndedAt: undefined,
    reasoningMessageId: undefined,
    verificationStatus: undefined,
    notice: undefined,
    error: undefined,
  };
}

export function markControllerError(state: TuiState, error: string): TuiState {
  return finishReasoning({ ...state, phase: "failed", error, pendingApproval: undefined });
}

export function appendReasoningText(state: TuiState, text: string): TuiState {
  if (!text) {
    return state;
  }
  const now = Date.now();
  const combined = state.reasoningText + text;
  return {
    ...state,
    reasoningText: combined.length > 64_000 ? `…${combined.slice(-64_000)}` : combined,
    responseActive: true,
    responseStartIndex: state.responseStartIndex ?? state.messages.length,
    reasoningActive: true,
    reasoningMessageId: undefined,
    reasoningStartedAt: state.reasoningStartedAt ?? now,
    reasoningEndedAt: undefined,
  };
}

export function appendStreamingText(state: TuiState, text: string): TuiState {
  const source = state.streamingText + text;
  const current = state.reasoningActive ? finishReasoning(state) : state;
  const { complete, rest } = splitStreamingMarkdown(source);
  if (!complete) {
    return {
      ...current,
      streamingText: rest,
      responseActive: true,
      responseStartIndex: current.responseStartIndex ?? current.messages.length,
    };
  }
  const message: ViewMessage = {
    id: `streaming-${state.runId ?? "new"}-${state.messages.length}-${state.lastSeq}`,
    seq: state.lastSeq,
    role: "assistant",
    content: complete,
    continuation: state.streamingBlocksStarted,
  };
  return {
    ...current,
    messages: [...current.messages, message],
    streamingText: rest,
    streamingBlocksStarted: true,
    responseActive: true,
    responseStartIndex: current.responseStartIndex ?? current.messages.length,
  };
}

export function splitStreamingMarkdown(source: string): { complete: string; rest: string } {
  let fence: "```" | "~~~" | undefined;
  let safeEnd = 0;
  let offset = 0;
  const lines = source.split(/(?<=\n)/);
  for (const line of lines) {
    offset += line.length;
    const marker = /^ {0,3}(```|~~~)/.exec(line)?.[1] as "```" | "~~~" | undefined;
    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (marker === fence) {
        fence = undefined;
        safeEnd = offset;
      }
      continue;
    }
    if (!fence && /^\s*(?:\n|$)/.test(line)) {
      safeEnd = offset;
    }
  }
  return { complete: source.slice(0, safeEnd), rest: source.slice(safeEnd) };
}

export function applyRunEvent(current: TuiState, event: PublicRunEvent): TuiState {
  if (event.type === "message.assistant.delta") {
    return appendStreamingText(current, String(event.payload.text ?? ""));
  }
  if (event.type === "message.reasoning.delta") {
    return appendReasoningText(current, String(event.payload.text ?? ""));
  }
  if (event.seq <= current.lastSeq) {
    return current;
  }
  const state = { ...current, lastSeq: event.seq, runId: event.runId };
  switch (event.type) {
    case "run.started":
      return { ...state, phase: "running", error: undefined };
    case "run.resumed":
      return {
        ...state,
        phase: "running",
        streamingText: "",
        streamingBlocksStarted: false,
        reasoningText: "",
        reasoningActive: false,
        reasoningStartedAt: undefined,
        reasoningEndedAt: undefined,
        verificationStatus: undefined,
        error: undefined,
      };
    case "context.compacted":
      return {
        ...state,
        notice: `Context compacted · omitted ${Number(event.payload.omittedMessages)} older messages`,
      };
    case "run.steered":
      return {
        ...state,
        phase: "running",
        steeringPending: state.steeringPending + 1,
        notice: "Guidance queued · applies after the current model turn",
      };
    case "message.user":
      return appendMessage(
        {
          ...state,
          steeringPending: event.payload.steeringId
            ? Math.max(0, state.steeringPending - 1)
            : state.steeringPending,
        },
        event.eventId,
        event.seq,
        "user",
        messageContent(event.payload.message),
      );
    case "message.assistant": {
      const content = state.streamingBlocksStarted
        ? state.streamingText
        : messageContent(event.payload.message) || state.streamingText;
      return finishReasoning(
        {
          ...appendMessage(
            state,
            event.eventId,
            event.seq,
            "assistant",
            content,
            state.streamingBlocksStarted,
          ),
          streamingText: "",
          streamingBlocksStarted: false,
        },
        event.eventId,
      );
    }
    case "model.started":
      return {
        ...state,
        responseActive: true,
        responseStartIndex: state.messages.length,
        reasoningText: "",
        reasoningActive: false,
        reasoningStartedAt: undefined,
        reasoningEndedAt: undefined,
        reasoningMessageId: undefined,
        modelActivity: {
          ...state.modelActivity,
          active: true,
          iteration: Number(event.payload.iteration ?? 0),
          startedAt: Date.parse(event.timestamp),
        },
      };
    case "model.completed":
      return {
        ...state,
        modelActivity: {
          active: false,
          startedAt: undefined,
          calls: state.modelActivity.calls + 1,
          iteration: state.modelActivity.iteration,
          durationMs: state.modelActivity.durationMs + Number(event.payload.durationMs ?? 0),
          failures: state.modelActivity.failures,
        },
      };
    case "model.failed":
      return {
        ...state,
        responseActive: false,
        modelActivity: {
          ...state.modelActivity,
          active: false,
          startedAt: undefined,
          durationMs: state.modelActivity.durationMs + Number(event.payload.durationMs ?? 0),
          failures: state.modelActivity.failures + 1,
        },
      };
    case "model.usage":
      return {
        ...state,
        contextTokens: Number(event.payload.inputTokens ?? state.contextTokens),
        usage: {
          inputTokens: state.usage.inputTokens + Number(event.payload.inputTokens ?? 0),
          outputTokens: state.usage.outputTokens + Number(event.payload.outputTokens ?? 0),
        },
      };
    case "plan.updated": {
      const plan = event.payload.plan as ViewTaskPlan | undefined;
      if (!plan || typeof plan.title !== "string" || !Array.isArray(plan.steps)) {
        return state;
      }
      return { ...state, taskPlan: structuredClone(plan) };
    }
    case "tool.proposed": {
      const call = toolCall(event.payload.call);
      return {
        ...state,
        phase: "running",
        tools: [
          ...state.tools,
          {
            ...call,
            seq: event.seq,
            status: "proposed",
            decision: undefined,
            summary: undefined,
            output: undefined,
            artifacts: undefined,
          },
        ],
      };
    }
    case "tool.approval_required": {
      const callId = String(event.payload.callId);
      const proposed = state.tools.find((tool) => tool.id === callId);
      const pendingApproval: PendingApproval = {
        runId: event.runId,
        call: proposed
          ? { id: proposed.id, name: proposed.name, arguments: proposed.arguments }
          : { id: callId, name: "unknown", arguments: "{}" },
        risk: approvalRisk(event.payload.risk),
        reason: String(event.payload.reason),
      };
      return { ...state, phase: "awaiting_approval", pendingApproval };
    }
    case "tool.decided": {
      const callId = String(event.payload.callId);
      const decision = event.payload.decision === "approved" ? "approved" : "rejected";
      return {
        ...state,
        phase: "running",
        pendingApproval:
          state.pendingApproval?.call.id === callId ? undefined : state.pendingApproval,
        tools: updateTool(state.tools, callId, { decision }),
      };
    }
    case "tool.started":
      return {
        ...state,
        phase: "running",
        tools: updateTool(state.tools, String(event.payload.callId), {
          status: "running",
          startedAt: Date.parse(event.timestamp),
        }),
      };
    case "tool.result": {
      const result = event.payload.result as {
        callId: string;
        name: string;
        status: "success" | "error";
        summary?: string;
        content: string;
        artifacts?: ToolCard["artifacts"];
        changedFiles?: string[];
      };
      const startedAt = state.tools.find((tool) => tool.id === result.callId)?.startedAt;
      const durationMs = startedAt
        ? Math.max(0, Date.parse(event.timestamp) - startedAt)
        : undefined;
      return {
        ...state,
        tools: updateTool(state.tools, result.callId, {
          seq: event.seq,
          name: result.name,
          status: result.status,
          summary: result.summary,
          output: result.content,
          ...(durationMs !== undefined ? { durationMs } : {}),
          artifacts: result.artifacts,
        }),
        changedFiles: [...new Set([...state.changedFiles, ...(result.changedFiles ?? [])])],
      };
    }
    case "verification.requested":
      return {
        ...state,
        phase: "running",
        verificationStatus: "running",
        notice: `Verification ${String(event.payload.attempt)}: ${String(event.payload.reason)}`,
      };
    case "verification.finished":
      return {
        ...state,
        verificationStatus: event.payload.success === false ? "failed" : "passed",
        notice: String(event.payload.evidence),
      };
    case "run.completed":
      return finishReasoning({
        ...state,
        phase: "completed",
        streamingText: "",
        streamingBlocksStarted: false,
        pendingApproval: undefined,
        verificationStatus:
          state.verificationStatus ??
          (event.payload.verification === "passed" ? "passed" : "not-required"),
        notice: event.payload.verification === "passed" ? "Verification passed" : undefined,
        error: undefined,
      });
    case "run.blocked":
      return terminal(state, "blocked", String(event.payload.reason));
    case "run.failed":
      return terminal(state, "failed", String(event.payload.error));
    case "run.cancelled":
      return terminal(state, "cancelled", String(event.payload.reason));
  }
}

function terminal(
  state: TuiState,
  phase: "blocked" | "failed" | "cancelled",
  error: string,
): TuiState {
  return finishReasoning({
    ...state,
    phase,
    error,
    streamingText: "",
    streamingBlocksStarted: false,
    pendingApproval: undefined,
  });
}

function finishReasoning(state: TuiState, messageId?: string): TuiState {
  return {
    ...state,
    responseActive: false,
    reasoningActive: false,
    reasoningEndedAt: state.reasoningStartedAt ? (state.reasoningEndedAt ?? Date.now()) : undefined,
    reasoningMessageId: messageId ?? state.reasoningMessageId,
  };
}

function appendMessage(
  state: TuiState,
  id: string,
  seq: number,
  role: ViewMessage["role"],
  content: string,
  continuation = false,
): TuiState {
  if (!content) {
    return state;
  }
  return { ...state, messages: [...state.messages, { id, seq, role, content, continuation }] };
}

function updateTool(tools: ToolCard[], callId: string, update: Partial<ToolCard>): ToolCard[] {
  let found = false;
  const updated = tools.map((tool) => {
    if (tool.id !== callId) {
      return tool;
    }
    found = true;
    return { ...tool, ...update };
  });
  if (found) {
    return updated;
  }
  return [
    ...tools,
    {
      id: callId,
      seq: update.seq ?? 0,
      name: update.name ?? "unknown",
      arguments: "{}",
      status: update.status ?? "proposed",
      decision: update.decision,
      summary: update.summary,
      output: update.output,
      artifacts: update.artifacts,
    },
  ];
}

function toolCall(value: unknown): ViewToolCall {
  const call = value as { id: string; name: string; arguments: string };
  return { id: call.id, name: call.name, arguments: call.arguments };
}

function messageContent(value: unknown): string {
  return String((value as { content?: unknown }).content ?? "");
}

function approvalRisk(value: unknown): PendingApproval["risk"] {
  return value === "low" || value === "high" ? value : "medium";
}
