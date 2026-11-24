import { describe, expect, it } from "vitest";
import { RunCommandQueue } from "../../packages/api/src/run-command-queue.js";

describe("RunCommandQueue", () => {
  it("serializes one run without blocking other runs", async () => {
    const queue = new RunCommandQueue();
    const gate = deferred();
    const order: string[] = [];
    const first = queue.run("one", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = queue.run("one", () => {
      order.push("second");
    });
    const other = queue.run("two", () => {
      order.push("other");
    });

    await other;
    expect(order).toEqual(["first:start", "other"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "other", "first:end", "second"]);
  });

  it("continues after a rejected command", async () => {
    const queue = new RunCommandQueue();
    await expect(
      queue.run("one", () => {
        throw new Error("failed command");
      }),
    ).rejects.toThrow("failed command");
    await expect(queue.run("one", () => "next result")).resolves.toBe("next result");
  });
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
