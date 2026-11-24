export class RunCommandQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<Type>(runId: string, operation: () => Promise<Type> | Type): Promise<Type> {
    const previous = this.tails.get(runId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(runId, tail);
    void tail.then(() => {
      if (this.tails.get(runId) === tail) {
        this.tails.delete(runId);
      }
    });
    return result;
  }
}
