export interface RetryOptions {
  attempts: number;
  signal: AbortSignal;
  shouldRetry(error: unknown): boolean;
  delay(error: unknown, attempt: number): number;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || !options.shouldRetry(error)) {
        throw error;
      }
      await sleep(options.delay(error, attempt), options.signal);
    }
  }
  throw lastError;
}

export function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw signal.reason;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
