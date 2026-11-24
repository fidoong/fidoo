import type { BackgroundTaskEvent } from "@fidoo/protocol";

export class TaskHub {
  private readonly listeners = new Set<(event: BackgroundTaskEvent) => void>();

  publish(event: BackgroundTaskEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(): AsyncIterable<BackgroundTaskEvent> {
    const stream = new TaskStream();
    const unsubscribe = this.listen((event) => stream.push(event));
    return {
      [Symbol.asyncIterator]: () => {
        const iterator = stream[Symbol.asyncIterator]();
        return {
          next: () => iterator.next(),
          return: async (value?: unknown) => {
            stream.close();
            unsubscribe();
            return iterator.return ? iterator.return(value) : { value, done: true };
          },
          throw: async (error?: unknown) => {
            stream.close();
            unsubscribe();
            if (iterator.throw) return iterator.throw(error);
            throw error;
          },
        };
      },
    };
  }

  private listen(listener: (event: BackgroundTaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class TaskStream {
  private readonly queue: BackgroundTaskEvent[] = [];
  private waiting: ((result: IteratorResult<BackgroundTaskEvent>) => void) | undefined;
  private closed = false;

  push(event: BackgroundTaskEvent): void {
    if (this.closed) return;
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<BackgroundTaskEvent> {
    while (!this.closed) {
      const event = this.queue.shift();
      if (event) {
        yield event;
        continue;
      }
      const next = await new Promise<IteratorResult<BackgroundTaskEvent>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
