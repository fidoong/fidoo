import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testApi } from "../helpers/api.js";
import { assistant, call } from "../helpers/fake-model.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("permission mode API", () => {
  it("approves a plan and persists subsequent mode changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-api-plan-"));
    directories.push(cwd);
    const { client } = testApi(
      [
        assistant("Planning", [
          call("plan", "update_plan", {
            title: "Inspect project",
            steps: [{ id: "inspect", title: "Inspect project", status: "pending" }],
          }),
        ]),
        assistant("Plan ready"),
        assistant("Done"),
      ],
      { permission: "plan" },
    );
    const { runId } = await client.run.start({ task: "Inspect project", cwd, mode: "plan" });
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "plan.awaiting_approval") break;
    }
    expect((await client.mode.get({ runId })).mode).toBe("plan");

    await client.plan.respond({ runId, revision: 1, decision: "approved", mode: "acceptEdits" });
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      if (event.type === "run.completed") break;
    }
    expect((await client.mode.get({ runId })).mode).toBe("acceptEdits");
    expect((await client.run.get({ runId })).status).toBe("completed");

    expect((await client.mode.set({ runId, mode: "manual" })).mode).toBe("manual");
    expect((await client.mode.get({ runId })).mode).toBe("manual");
  });
});
