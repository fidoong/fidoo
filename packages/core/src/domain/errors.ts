export class AgentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "configuration"
      | "provider"
      | "tool"
      | "approval"
      | "verification"
      | "storage"
      | "cancelled"
      | "budget",
    readonly recoverable = false,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
