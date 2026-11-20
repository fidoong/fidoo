import type { PublicRunEvent } from "@fidoo/protocol";

type Listener = (event: PublicRunEvent) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly sequences = new Map<string, number>();

  publish(event: PublicRunEvent): void {
    this.sequences.set(event.runId, Math.max(this.sequences.get(event.runId) ?? 0, event.seq));
    for (const listener of this.listeners.get(event.runId) ?? []) {
      listener(event);
    }
  }

  publishTransient(event: PublicRunEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      listener(event);
    }
  }

  sequence(runId: string): number {
    return this.sequences.get(runId) ?? 0;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }
}

export class PublicEventStream {
  private readonly queue: PublicRunEvent[] = [];
  private waiting: ((value: IteratorResult<PublicRunEvent>) => void) | undefined;
  private closed = false;

  push(event: PublicRunEvent): void {
    if (this.closed) {
      return;
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<PublicRunEvent> {
    while (!this.closed) {
      const event = this.queue.shift();
      if (event) {
        yield event;
        continue;
      }
      const next = await new Promise<IteratorResult<PublicRunEvent>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}
