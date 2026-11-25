import { paginateEvents, projectRun, redact } from "@fidoo/observability";
import type { PublicRunEvent } from "@fidoo/protocol";
import { describe, expect, it } from "vitest";

describe("observability projector", () => {
  it("builds tool, approval and verification spans with aggregate metrics", () => {
    const events = [
      event(1, "2026-01-01T00:00:00.000Z", "run.started", {
        task: "Fix authentication",
        cwd: "/workspace",
      }),
      event(2, "2026-01-01T00:00:01.000Z", "tool.proposed", {
        call: { id: "call-1", name: "edit_file", arguments: '{"path":"a.ts"}' },
      }),
      event(3, "2026-01-01T00:00:02.000Z", "tool.approval_required", {
        callId: "call-1",
        risk: "medium",
        reason: "Edit workspace",
      }),
      event(4, "2026-01-01T00:00:04.000Z", "tool.decided", {
        callId: "call-1",
        decision: "approved",
        reason: "",
      }),
      event(5, "2026-01-01T00:00:04.500Z", "tool.started", { callId: "call-1" }),
      event(6, "2026-01-01T00:00:05.500Z", "tool.result", {
        result: {
          callId: "call-1",
          name: "edit_file",
          status: "success",
          content: "Edited",
          changedFiles: ["a.ts"],
          artifacts: [{ id: "a".repeat(64), name: "edit.diff", bytes: 20 }],
        },
      }),
      event(7, "2026-01-01T00:00:06.000Z", "verification.requested", {
        reason: "Changed files",
        attempt: 1,
      }),
      event(8, "2026-01-01T00:00:07.000Z", "verification.finished", {
        success: true,
        evidence: "pnpm test",
      }),
      event(9, "2026-01-01T00:00:08.000Z", "model.usage", {
        inputTokens: 100,
        outputTokens: 20,
        uncachedInputTokens: 50,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
      }),
      event(10, "2026-01-01T00:00:09.000Z", "run.completed", {
        summary: "Fixed",
        verification: "passed",
      }),
    ];

    const run = projectRun("run-1", events);
    expect(run).toMatchObject({
      status: "completed",
      durationMs: 9000,
      finalSummary: "Fixed",
      metrics: {
        inputTokens: 100,
        outputTokens: 20,
        uncachedInputTokens: 50,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        cacheHitRate: 0.4,
        toolCalls: 1,
        failedTools: 0,
        approvalWaitMs: 2000,
        changedFiles: 1,
        verified: true,
      },
    });
    expect(run.spans).toHaveLength(3);
    expect(run.spans[1]).toMatchObject({
      kind: "tool",
      name: "edit_file",
      status: "success",
      durationMs: 1000,
      approvalWaitMs: 2000,
    });
    expect(run.spans[2]).toMatchObject({ kind: "verification", durationMs: 1000 });
    expect(run.artifacts).toHaveLength(1);
  });

  it("builds accurate model spans from lifecycle events", () => {
    const run = projectRun("run-1", [
      event(1, "2026-01-01T00:00:00.000Z", "run.started", { task: "Inspect", cwd: "/" }),
      event(2, "2026-01-01T00:00:01.000Z", "model.started", { iteration: 1, model: "fake-model" }),
      event(3, "2026-01-01T00:00:03.500Z", "model.completed", {
        iteration: 1,
        model: "fake-model",
        durationMs: 2500,
        contentLength: 4,
        toolCalls: 0,
      }),
      event(4, "2026-01-01T00:00:04.000Z", "run.completed", {
        summary: "Done",
        verification: "not-required",
      }),
    ]);
    expect(run.spans[1]).toMatchObject({
      kind: "model",
      name: "fake-model",
      status: "success",
      durationMs: 2500,
    });
    expect(run.metrics).toMatchObject({
      modelCalls: 1,
      failedModelCalls: 0,
      modelDurationMs: 2500,
    });
  });

  it("marks unfinished spans incomplete after a terminal run", () => {
    const run = projectRun("run-1", [
      event(1, "2026-01-01T00:00:00.000Z", "run.started", { task: "Inspect", cwd: "/" }),
      event(2, "2026-01-01T00:00:01.000Z", "tool.started", { callId: "orphan" }),
      event(3, "2026-01-01T00:00:02.000Z", "run.failed", {
        error: "Disconnected",
        recoverable: true,
      }),
    ]);
    expect(run.spans[1]).toMatchObject({ status: "incomplete", name: "tool" });
  });

  it("paginates persistent events and excludes transient reasoning", () => {
    const events = [
      event(1, "2026-01-01T00:00:00.000Z", "run.started", { task: "Inspect", cwd: "/" }),
      event(1, "2026-01-01T00:00:00.100Z", "message.reasoning.delta", { text: "private" }),
      event(2, "2026-01-01T00:00:01.000Z", "message.assistant", {
        message: { role: "assistant", content: "Done" },
      }),
      event(3, "2026-01-01T00:00:02.000Z", "run.completed", {
        summary: "Done",
        verification: "not-required",
      }),
    ];
    const page = paginateEvents(events, 1, 1);
    expect(page.items.map((item) => item.seq)).toEqual([2]);
    expect(page.hasMore).toBe(true);
    expect(JSON.stringify(page)).not.toContain("private");
  });

  it("redacts nested credentials and authorization strings", () => {
    const value = redact({
      apiKey: "secret-value",
      nested: { authorization: "Bearer abcdefghijklmnop" },
      content: "api_key=very-secret-value",
      inputTokens: 100,
    });
    expect(JSON.stringify(value)).not.toContain("secret-value");
    expect(JSON.stringify(value)).not.toContain("abcdefghijklmnop");
    expect(value).toMatchObject({ inputTokens: 100 });
  });
});

function event(
  seq: number,
  timestamp: string,
  type: string,
  payload: Record<string, unknown>,
): PublicRunEvent {
  return {
    protocolVersion: "v1",
    runId: "run-1",
    seq,
    eventId: `event-${seq}-${type}`,
    timestamp,
    type: type as PublicRunEvent["type"],
    payload,
  };
}
