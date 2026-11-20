import type { PublicRunEvent, RunSnapshot } from "@fidoo/protocol";
import type { OutputFormat } from "./config.js";

export function renderPublicEvent(event: PublicRunEvent, format: OutputFormat): void {
  if (format === "jsonl") {
    if (event.type !== "message.assistant.delta") {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
    return;
  }
  if (format !== "text") {
    return;
  }
  switch (event.type) {
    case "message.assistant.delta":
      process.stdout.write(String(event.payload.text ?? ""));
      break;
    case "message.assistant": {
      const message = event.payload.message as { toolCalls?: unknown[] };
      if (message.toolCalls?.length) {
        process.stdout.write("\n");
      }
      break;
    }
    case "tool.proposed": {
      const call = event.payload.call as { name: string; arguments: string };
      process.stderr.write(`\n→ ${call.name} ${call.arguments}\n`);
      break;
    }
    case "tool.decided":
      if (event.payload.decision === "rejected") {
        process.stderr.write(`  rejected: ${event.payload.reason}\n`);
      }
      break;
    case "tool.result": {
      const result = event.payload.result as {
        status: string;
        summary?: string;
        content: string;
      };
      process.stderr.write(`  ${result.status}: ${result.summary ?? summarize(result.content)}\n`);
      break;
    }
    case "verification.requested":
      process.stderr.write("\nVerification is required before completion.\n");
      break;
    case "run.failed":
    case "run.blocked":
    case "run.cancelled":
    case "run.completed":
    case "run.started":
    case "run.resumed":
    case "message.user":
    case "tool.approval_required":
    case "tool.started":
    case "verification.finished":
      break;
  }
}

export function renderFinal(state: RunSnapshot, format: OutputFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(state)}\n`);
    return;
  }
  if (format === "jsonl") {
    return;
  }
  process.stdout.write("\n");
  if (state.status === "failed") {
    process.stderr.write(`Run failed: ${state.error}\nRun id: ${state.runId}\n`);
  } else if (state.status === "blocked") {
    process.stderr.write(`Run blocked: ${state.error}\nRun id: ${state.runId}\n`);
  } else if (state.status === "cancelled") {
    process.stderr.write(`Run cancelled. Run id: ${state.runId}\n`);
  } else {
    process.stderr.write(`Run ${state.runId} ${state.status}\n`);
  }
}

function summarize(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}
