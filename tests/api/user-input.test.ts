import { UserInputBroker } from "@fidoo/api";
import { describe, expect, it } from "vitest";

const questions = [
  {
    id: "features",
    question: "Which features?",
    multiSelect: true,
    options: [
      { id: "test", label: "Tests" },
      { id: "docs", label: "Docs" },
    ],
  },
];

describe("UserInputBroker", () => {
  it("keeps invalid answers pending until a valid response arrives", async () => {
    const broker = new UserInputBroker();
    const pending = broker.ask(
      { runId: "run-1", callId: "call-1", questions },
      new AbortController().signal,
    );
    expect(() =>
      broker.respond({ runId: "run-1", callId: "call-1", answers: { features: ["other"] } }),
    ).toThrow("Invalid option");
    broker.respond({
      runId: "run-1",
      callId: "call-1",
      answers: { features: ["test", "docs"] },
    });
    await expect(pending).resolves.toEqual({ answers: { features: ["test", "docs"] } });
  });

  it("cancels a pending question without resolving it later", async () => {
    const broker = new UserInputBroker();
    const controller = new AbortController();
    const pending = broker.ask({ runId: "run-1", callId: "call-1", questions }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("User input cancelled");
    expect(() =>
      broker.respond({ runId: "run-1", callId: "call-1", answers: { features: ["test"] } }),
    ).toThrow("No pending user input");
  });
});
