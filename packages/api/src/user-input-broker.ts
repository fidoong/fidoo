import {
  AgentError,
  type UserInputPort,
  type UserInputQuestion,
  type UserInputResponse,
} from "@fidoo/core";
import type { InputRespondParams } from "@fidoo/protocol";

interface PendingInput {
  questions: UserInputQuestion[];
  resolve(response: UserInputResponse): void;
}

export class UserInputBroker implements UserInputPort {
  private readonly pending = new Map<string, PendingInput>();

  async ask(
    request: { runId: string; callId: string; questions: UserInputQuestion[] },
    signal: AbortSignal,
  ): Promise<UserInputResponse> {
    const key = inputKey(request.runId, request.callId);
    if (this.pending.has(key))
      throw new AgentError(`Input already pending: ${key}`, "configuration");
    return new Promise<UserInputResponse>((resolve, reject) => {
      this.pending.set(key, { questions: request.questions, resolve });
      signal.addEventListener(
        "abort",
        () => {
          if (this.pending.delete(key)) reject(new AgentError("User input cancelled", "cancelled"));
        },
        { once: true },
      );
    });
  }

  respond(params: InputRespondParams): void {
    const key = inputKey(params.runId, params.callId);
    const pending = this.pending.get(key);
    if (!pending)
      throw new AgentError(`No pending user input for ${params.callId}`, "configuration");
    for (const question of pending.questions) {
      const answers = params.answers[question.id];
      if (!answers?.length)
        throw new AgentError(`Missing answer for ${question.id}`, "configuration");
      if (!question.multiSelect && answers.length !== 1) {
        throw new AgentError(`Question ${question.id} accepts exactly one answer`, "configuration");
      }
      if (question.options) {
        const allowed = new Set(question.options.map((option) => option.id));
        if (answers.some((answer) => !allowed.has(answer))) {
          throw new AgentError(`Invalid option for ${question.id}`, "configuration");
        }
      }
    }
    this.pending.delete(key);
    pending.resolve({ answers: params.answers });
  }
}

function inputKey(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}
