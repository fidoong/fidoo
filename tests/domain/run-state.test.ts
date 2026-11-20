import type { EventPayload, EventType } from "@fidoo/core";
import { createEvent, needsVerification, replayRun } from "@fidoo/core";
import { describe, expect, it } from "vitest";

function event<Type extends EventType>(seq: number, type: Type, payload: EventPayload<Type>) {
  return createEvent(
    {
      eventId: `event-${seq}`,
      runId: "run-1",
      seq,
      timestamp: new Date(seq * 1000).toISOString(),
    },
    type,
    payload,
  );
}

describe("canonical trajectory", () => {
  it("rebuilds messages, mutations and verification evidence", () => {
    const events = [
      event(1, "run.started", { task: "Fix code", cwd: "/workspace" }),
      event(2, "message.user", {
        message: { role: "user", source: "user", content: "Fix code" },
      }),
      event(3, "tool.result", {
        result: {
          callId: "call-1",
          name: "edit_file",
          status: "success",
          content: "edited",
          changedFiles: ["src/a.ts"],
        },
      }),
      event(4, "tool.result", {
        result: {
          callId: "call-2",
          name: "bash",
          status: "success",
          content: "passed",
          verification: { command: "pnpm test", exitCode: 0 },
        },
      }),
    ];
    const state = replayRun("run-1", events);
    expect(state.messages).toHaveLength(3);
    expect([...state.changedFiles]).toEqual(["src/a.ts"]);
    expect(needsVerification(state)).toBe(false);
  });

  it("requires verification after a later mutation", () => {
    const state = replayRun("run-1", [
      event(1, "run.started", { task: "Fix", cwd: "/workspace" }),
      event(2, "tool.result", {
        result: {
          callId: "verify",
          name: "bash",
          status: "success",
          content: "passed",
          verification: { command: "node --test", exitCode: 0 },
        },
      }),
      event(3, "tool.result", {
        result: {
          callId: "edit",
          name: "edit_file",
          status: "success",
          content: "edited",
          changedFiles: ["a.ts"],
        },
      }),
    ]);
    expect(needsVerification(state)).toBe(true);
  });

  it("rejects a broken event sequence", () => {
    expect(() => replayRun("run-1", [event(2, "run.resumed", { reason: "bad sequence" })])).toThrow(
      "Invalid event sequence",
    );
  });
});
