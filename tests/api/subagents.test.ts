import { createEvent } from "@fidoo/core";
import { describe, expect, it } from "vitest";
import { testApi } from "../helpers/api.js";

describe("subagent run topology", () => {
  it("filters root sessions and queries children by parent run", async () => {
    const { client, store } = testApi([]);
    await store.append(started("parent", "Root task"));
    await store.append(
      started("child", "Child task", {
        kind: "subagent",
        parentRunId: "parent",
        parentCallId: "delegate-1",
        agentType: "explore",
      }),
    );

    expect((await client.run.list()).map((run) => run.runId)).toEqual(["parent"]);
    expect((await client.run.list({ parentRunId: "parent" })).map((run) => run.runId)).toEqual([
      "child",
    ]);
    expect(
      (await client.run.list({ includeSubagents: true })).map((run) => run.runId).sort(),
    ).toEqual(["child", "parent"]);
  });
});

function started(
  runId: string,
  task: string,
  origin?: { kind: "subagent"; parentRunId: string; parentCallId: string; agentType: "explore" },
) {
  return createEvent(
    {
      eventId: `${runId}-started`,
      runId,
      seq: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    "run.started",
    { task, cwd: "/workspace", ...(origin ? { origin } : {}) },
  );
}
