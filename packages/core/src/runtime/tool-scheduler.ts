import type { ToolDefinition } from "../ports/tool.js";

export class ToolScheduler {
  private exclusiveTail: Promise<void> = Promise.resolve();
  private readers = new Set<Promise<unknown>>();

  schedule<Type>(
    concurrency: ToolDefinition["concurrency"],
    operation: () => Promise<Type>,
  ): Promise<Type> {
    if (concurrency === "safe") {
      const result = this.exclusiveTail.then(operation);
      this.readers.add(result);
      const remove = () => this.readers.delete(result);
      void result.then(remove, remove);
      return result;
    }
    const result = Promise.all([this.exclusiveTail, ...this.readers]).then(operation);
    this.exclusiveTail = result.then(
      () => undefined,
      () => undefined,
    );
    this.readers.clear();
    return result;
  }
}
