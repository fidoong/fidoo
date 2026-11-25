export interface UserInputOption {
  id: string;
  label: string;
  description?: string;
}

export interface UserInputQuestion {
  id: string;
  question: string;
  options?: UserInputOption[];
  multiSelect?: boolean;
}

export interface UserInputRequest {
  runId: string;
  callId: string;
  questions: UserInputQuestion[];
}

export interface UserInputResponse {
  answers: Record<string, string[]>;
}

export interface UserInputPort {
  ask(request: UserInputRequest, signal: AbortSignal): Promise<UserInputResponse>;
}
