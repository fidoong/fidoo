import { AgentError } from "@fidoo/core";

interface CachedResult {
  fingerprint: string;
  promise: Promise<unknown>;
  settled: boolean;
}

export class RequestResultCache {
  private readonly results = new Map<string, CachedResult>();

  constructor(private readonly limit = 1000) {}

  run<Type>(
    method: string,
    requestId: string | undefined,
    params: unknown,
    operation: () => Promise<Type> | Type,
  ): Promise<Type> {
    if (!requestId) return Promise.resolve().then(operation);
    const key = `${method}:${requestId}`;
    const fingerprint = JSON.stringify(params);
    const existing = this.results.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new AgentError(
          `Request id was already used with different params: ${requestId}`,
          "configuration",
        );
      }
      return existing.promise as Promise<Type>;
    }
    const entry: CachedResult = {
      fingerprint,
      promise: Promise.resolve().then(operation),
      settled: false,
    };
    this.results.set(key, entry);
    entry.promise.then(
      () => {
        entry.settled = true;
        this.evict();
      },
      () => {
        if (this.results.get(key) === entry) this.results.delete(key);
      },
    );
    return entry.promise as Promise<Type>;
  }

  private evict(): void {
    if (this.results.size <= this.limit) return;
    for (const [key, entry] of this.results) {
      if (entry.settled) {
        this.results.delete(key);
        if (this.results.size <= this.limit) return;
      }
    }
  }
}
