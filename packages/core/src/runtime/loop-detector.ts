import type { ToolCall } from "../domain/messages.js";

export class LoopDetector {
  private readonly fingerprints = new Map<string, number>();

  constructor(private readonly threshold = 4) {}

  record(call: ToolCall): string | undefined {
    const fingerprint = `${call.name}:${normalizeArguments(call.arguments)}`;
    const count = (this.fingerprints.get(fingerprint) ?? 0) + 1;
    this.fingerprints.set(fingerprint, count);
    if (count < this.threshold) {
      return undefined;
    }
    return `Tool call repeated ${count} times without a changed strategy: ${call.name}. Stop repeating it; inspect the previous result and choose a different action or explain the blocker.`;
  }
}

function normalizeArguments(source: string): string {
  try {
    return JSON.stringify(sortValue(JSON.parse(source)));
  } catch {
    return source;
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
