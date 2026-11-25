import { z } from "zod";
import type { AutoReviewInput, AutoReviewPort, AutoReviewResult } from "../ports/auto-review.js";
import type { ModelPort, ModelUsage } from "../ports/model.js";

const reviewSchema = z.object({
  action: z.enum(["allow", "ask", "deny"]),
  category: z.enum(["aligned", "uncertain", "unsafe", "out_of_scope"]),
  reason: z.string().min(1).max(500),
});

export class ModelAutoReviewer implements AutoReviewPort {
  constructor(
    private readonly model: ModelPort,
    private readonly modelName: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async review(input: AutoReviewInput, signal: AbortSignal): Promise<AutoReviewResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, this.timeoutMs);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    let content = "";
    let usage: ModelUsage | undefined;
    try {
      for await (const event of this.model.stream(
        {
          model: this.modelName,
          systemPrompt:
            "You are a security reviewer for a coding agent. Review only the proposed tool action against the user's task and the execution boundaries. Do not call tools. Do not reveal hidden reasoning. Return only a compact JSON object with action (allow, ask, deny), category (aligned, uncertain, unsafe, out_of_scope), and a short reason. Choose ask when uncertain or when human judgment is required. Choose deny for credentials, destructive external effects, sandbox escape, or actions outside the task. Never approve outside-workspace changes.",
          messages: [
            {
              role: "user",
              source: "harness",
              content: JSON.stringify({
                task: input.task,
                tool: input.tool.name,
                arguments: input.arguments,
                risk: input.risk,
                projectTrusted: input.projectTrusted,
                sandbox: input.sandbox,
              }),
            },
          ],
          tools: [],
          maxTokens: 500,
        },
        controller.signal,
      )) {
        if (event.type === "text.delta") content += event.text;
        if (event.type === "usage") {
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            uncachedInputTokens: event.uncachedInputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheWriteTokens: event.cacheWriteTokens,
          };
        }
      }
      const result = reviewSchema.parse(parseJson(content));
      return { ...result, ...(usage ? { usage } : {}) };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}

function parseJson(content: string): unknown {
  const normalized = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Auto reviewer returned no JSON object");
  return JSON.parse(normalized.slice(start, end + 1));
}
