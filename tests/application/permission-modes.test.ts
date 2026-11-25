import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelAutoReviewer, PolicyEngine, ToolRegistry } from "@fidoo/core";
import { createCodingTools, revisionOf } from "@fidoo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistant, call, FakeModel } from "../helpers/fake-model.js";
import { testRuntime } from "../helpers/runtime.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("agent permission modes", () => {
  it("separates plan, acceptEdits and legacy auto decisions", () => {
    const tools = new ToolRegistry(createCodingTools());
    const edit = tools.get("edit_file");
    const bash = tools.get("bash");
    if (!edit || !bash) throw new Error("Missing tools");
    expect(new PolicyEngine("plan").evaluate(edit, { path: "value.ts" }).action).toBe("deny");
    expect(
      new PolicyEngine("plan").evaluate(bash, { command: "git", args: ["status"] }).action,
    ).toBe("allow");
    expect(
      new PolicyEngine("plan").evaluate(bash, { command: "pnpm", args: ["test"] }).action,
    ).toBe("deny");
    expect(new PolicyEngine("acceptEdits").evaluate(edit, { path: "value.ts" }).action).toBe(
      "allow",
    );
    expect(
      new PolicyEngine("acceptEdits").evaluate(bash, { command: "pnpm", args: ["test"] }).action,
    ).toBe("ask");
    expect(
      new PolicyEngine("auto").evaluate(bash, { command: "pnpm", args: ["test"] }),
    ).toMatchObject({ action: "ask", requiresReview: true });
    expect(
      new PolicyEngine("auto").evaluate(bash, { command: "git", args: ["push"] }),
    ).toMatchObject({ action: "ask", requiresReview: true });
  });

  it("holds execution for plan approval, then applies acceptEdits without another prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-plan-mode-"));
    directories.push(cwd);
    const source = "export const broken = true;\n";
    const { service, store } = testRuntime(
      [
        assistant("Planning", [
          call("plan", "update_plan", {
            title: "Fix value",
            steps: [{ id: "edit", title: "Edit value.mjs", status: "pending" }],
          }),
        ]),
        assistant("Plan ready"),
        assistant("Editing", [
          call("edit", "edit_file", {
            path: "value.mjs",
            old_string: "true",
            new_string: "false",
            expected_revision: revisionOf(source),
          }),
        ]),
        assistant("Verified", [
          call("verify", "bash", { command: "node", args: ["--test", "value.test.mjs"] }),
        ]),
        assistant("Done"),
      ],
      { permission: "plan" },
    );
    await writeFile(
      join(cwd, "value.test.mjs"),
      'import assert from "node:assert/strict";\nimport { broken } from "./value.mjs";\nassert.equal(broken, false);\n',
    );
    await writeFile(join(cwd, "value.mjs"), source);
    const controller = new AbortController();
    const pending = await service.start("Fix value", cwd, controller.signal);
    expect(pending.status).toBe("awaiting_plan");
    expect(pending.permissionMode).toBe("plan");
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toBe(source);

    await service.decidePlan(pending.runId, "approved", "acceptEdits", 1);
    const completed = await service.resume(pending.runId, undefined, controller.signal);
    expect(completed.status).toBe("completed");
    expect(completed.permissionMode).toBe("acceptEdits");
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toContain("false");
    const events = await store.load(pending.runId);
    expect(events.some((event) => event.type === "plan.awaiting_approval")).toBe(true);
    expect(events.some((event) => event.type === "plan.approved")).toBe(true);
    expect(events.some((event) => event.type === "mode.changed")).toBe(true);
    expect(
      events
        .filter((event) => event.type === "tool.approval_required")
        .map((event) => event.payload.callId),
    ).not.toContain("edit");
  });

  it("keeps plan mode after rejection and does not modify the workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-plan-rejected-"));
    directories.push(cwd);
    const source = "export const broken = true;\n";
    await writeFile(join(cwd, "value.mjs"), source);
    const { service } = testRuntime(
      [
        assistant("Planning", [
          call("plan", "update_plan", {
            steps: [{ id: "edit", title: "Edit value.mjs", status: "pending" }],
          }),
        ]),
        assistant("Plan ready"),
        assistant("Revised plan"),
      ],
      { permission: "plan" },
    );
    const pending = await service.start("Fix value", cwd, new AbortController().signal);
    await expect(service.decidePlan(pending.runId, "approved", "acceptEdits", 2)).rejects.toThrow(
      "Plan is stale",
    );
    await service.decidePlan(pending.runId, "rejected", "manual", 1, "Add verification details");
    const revised = await service.resume(pending.runId, undefined, new AbortController().signal);
    expect(revised.status).toBe("awaiting_plan");
    expect(revised.permissionMode).toBe("plan");
    expect(await readFile(join(cwd, "value.mjs"), "utf8")).toBe(source);
  });

  it("parses real model review output and rejects invalid responses", async () => {
    const model = new FakeModel(
      [assistant('{"action":"allow","category":"aligned","reason":"Matches the task"}')],
      { inputTokens: 20, outputTokens: 5 },
    );
    const review = await new ModelAutoReviewer(model, "fake-model").review(
      {
        task: "Run tests",
        tool: reviewTool(),
        arguments: {},
        risk: "medium",
        projectTrusted: true,
      },
      new AbortController().signal,
    );
    expect(review).toMatchObject({ action: "allow", category: "aligned" });
    expect(review.usage).toMatchObject({ inputTokens: 20, outputTokens: 5 });
    const invalid = new ModelAutoReviewer(new FakeModel([assistant("not json")]), "fake-model");
    await expect(
      invalid.review(
        {
          task: "Run tests",
          tool: reviewTool(),
          arguments: {},
          risk: "medium",
          projectTrusted: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Auto reviewer returned no JSON object");
  });

  it("emits review events and allows reviewed actions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "fidoo-auto-review-"));
    directories.push(cwd);
    const source = "export const broken = true;\n";
    await writeFile(join(cwd, "value.mjs"), source);
    await writeFile(join(cwd, "value.test.mjs"), 'import assert from "node:assert/strict";\n');
    const autoReview = {
      review: vi.fn(async () => ({
        action: "allow" as const,
        category: "aligned" as const,
        reason: "Matches the task",
      })),
    };
    const { service, store } = testRuntime(
      [
        assistant("Editing", [
          call("edit", "edit_file", {
            path: "value.mjs",
            old_string: "true",
            new_string: "false",
            expected_revision: revisionOf(source),
          }),
        ]),
        assistant("Verify", [
          call("verify", "bash", { command: "node", args: ["--test", "value.test.mjs"] }),
        ]),
        assistant("Done"),
      ],
      { permission: "auto", autoReview },
    );
    const state = await service.start("Fix and test", cwd, new AbortController().signal);
    expect(state.status).toBe("completed");
    expect(autoReview.review).toHaveBeenCalledTimes(2);
    const events = await store.load(state.runId);
    expect(events.filter((event) => event.type === "permission.review.started")).toHaveLength(2);
    expect(events.filter((event) => event.type === "permission.review.completed")).toHaveLength(2);
  });

  it("blocks user input in dontAsk and allows isolated commands in bypass", async () => {
    const inputCwd = await mkdtemp(join(tmpdir(), "fidoo-dont-ask-"));
    directories.push(inputCwd);
    const { service } = testRuntime(
      [
        assistant("Question", [
          call("question", "request_user_input", {
            questions: [{ id: "scope", question: "Scope?", type: "input" }],
          }),
        ]),
      ],
      { permission: "manual", dontAsk: true },
    );
    const blocked = await service.start("Question", inputCwd, new AbortController().signal);
    expect(blocked.status).toBe("blocked");
    expect(blocked.error).toContain("dontAsk");

    const bypassCwd = await mkdtemp(join(tmpdir(), "fidoo-bypass-"));
    directories.push(bypassCwd);
    const { service: bypass } = testRuntime(
      [
        assistant("Read version", [
          call("version", "bash", { command: "node", args: ["--version"] }),
        ]),
        assistant("Done"),
      ],
      { permission: "manual", bypassPermissions: true },
    );
    const completed = await bypass.start("Read version", bypassCwd, new AbortController().signal);
    expect(completed.status).toBe("completed");
  });
});

function reviewTool() {
  const tool = new ToolRegistry(createCodingTools()).get("edit_file");
  if (!tool) throw new Error("Missing edit_file");
  return tool;
}
