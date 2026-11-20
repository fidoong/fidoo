import { defineTool, formatCommand, isVerificationCommand } from "@fidoo/core";
import { execa } from "execa";
import { z } from "zod";
import { resolveExistingPath } from "../system/workspace.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  command: z.string().min(1).describe("Executable name or path, without shell syntax"),
  args: z.array(z.string()).default([]).describe("Literal arguments; no expansion is applied"),
  cwd: z.string().default(".").describe("Workspace-relative working directory"),
  timeout_ms: z.number().int().min(1000).max(600000).default(120000),
});

export const bashTool = defineTool({
  name: "bash",
  description:
    "Execute one process directly without a shell. Use command plus an args array, for example command=pnpm and args=[test]. Shell pipelines, redirects, &&, substitution, and glob expansion are intentionally unsupported.",
  inputSchema,
  effect: "execute",
  risk: "medium",
  concurrency: "exclusive",
  idempotency: "never",
  execute: async (input, context) => {
    const cwd = await resolveExistingPath(context.cwd, input.cwd);
    const result = await execa(input.command, input.args, {
      cwd,
      shell: false,
      reject: false,
      all: true,
      timeout: input.timeout_ms,
      cancelSignal: context.signal,
      maxBuffer: 10 * 1024 * 1024,
      preferLocal: true,
      stripFinalNewline: false,
    });
    const exitCode = result.exitCode ?? 1;
    const command = formatCommand(input.command, input.args);
    const succeeded = exitCode === 0 && !result.failed && !result.timedOut;
    const output = result.all?.trim() ? result.all : result.shortMessage || result.message;
    const status = result.timedOut ? "Timed out" : succeeded ? "Succeeded" : "Failed";
    const content = `$ ${command}\nExit code: ${exitCode}\n${status}\n\n${output}`;
    return {
      summary: `${status}: ${command}${succeeded ? "" : ` (exit code ${exitCode})`}`,
      content: await boundedOutput(context, "command-output.txt", content),
      success: succeeded,
      ...(isVerificationCommand(input.command, input.args)
        ? { verification: { command, exitCode } }
        : {}),
    };
  },
});
