import { ToolScheduler } from "@fidoo/core";
import { describe, expect, it } from "vitest";

describe("ToolScheduler", () => {
  it("runs safe reads in parallel around exclusive operations", async () => {
    const scheduler = new ToolScheduler();
    const gate = deferred();
    const order: string[] = [];
    const first = scheduler.schedule("safe", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = scheduler.schedule("safe", async () => {
      order.push("second");
    });
    const write = scheduler.schedule("exclusive", async () => {
      order.push("write");
    });
    const last = scheduler.schedule("safe", async () => {
      order.push("last");
    });

    await second;
    expect(order).toEqual(["first:start", "second"]);
    gate.resolve();
    await Promise.all([first, write, last]);
    expect(order).toEqual(["first:start", "second", "first:end", "write", "last"]);
  });
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
