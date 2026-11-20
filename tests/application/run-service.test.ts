import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assistant } from "../helpers/fake-model.js";
import { testRuntime } from "../helpers/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace preflight", () => {
  it("rejects a missing workspace before creating a run or calling the model", async () => {
    const parent = await mkdtemp(join(tmpdir(), "agent-preflight-"));
    directories.push(parent);
    const { service, store, model } = testRuntime([assistant("Should not run")]);
    await expect(
      service.start("Fix tests", join(parent, "missing"), new AbortController().signal),
    ).rejects.toThrow("Workspace directory does not exist");
    expect(model.requests).toHaveLength(0);
    expect(await store.list()).toHaveLength(0);
  });
});
