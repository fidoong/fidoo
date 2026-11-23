import { AgentError, backoffDelay, errorMessage, withRetry } from "@fidoo/core";

export async function openProviderStream(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await withRetry(
      async () => {
        const response = await fetch(url, { ...init, signal });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 4000);
          throw new AgentError(
            `Provider returned HTTP ${response.status}: ${detail || response.statusText}`,
            "provider",
            isRetryableStatus(response.status),
          );
        }
        return response;
      },
      {
        attempts: 3,
        signal,
        shouldRetry: (error) =>
          error instanceof TypeError || (error instanceof AgentError && error.recoverable),
        delay: (_error, attempt) => backoffDelay(attempt),
      },
    );
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(`Cannot connect to provider: ${errorMessage(error)}`, "provider", true);
  }
}

export async function* readSse(response: Response): AsyncIterable<{ event: string; data: string }> {
  if (!response.body) {
    throw new AgentError("Provider returned an empty streaming body", "provider", true);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const boundary = /\r?\n\r?\n/g;
    let match = boundary.exec(buffer);
    while (match) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      boundary.lastIndex = 0;
      const event = parseSseBlock(block);
      if (event) {
        if (event.data === "[DONE]") return;
        yield event;
      }
      match = boundary.exec(buffer);
    }
    if (chunk.done) break;
  }
  const event = parseSseBlock(buffer);
  if (event && event.data !== "[DONE]") yield event;
}

function parseSseBlock(block: string): { event: string; data: string } | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
