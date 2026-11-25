import {
  classifyVerification,
  classifyVerificationFailure,
  defineTool,
  formatCommand,
  type RequiredCheck,
  requiredCheckForCommand,
  type VerificationEvidence,
} from "@fidoo/core";
import { execa } from "execa";
import { z } from "zod";
import { CommandExecutor } from "../execution/command-executor.js";
import { terminateProcessTree } from "../execution/process.js";
import { resolveExistingPath } from "../system/workspace.js";
import { BackgroundTaskManager } from "../tasks/background-task-manager.js";
import { boundedOutput } from "./output.js";

const inputSchema = z.object({
  command: z.string().min(1).describe("Executable name or path, without shell syntax"),
  args: z.array(z.string()).default([]).describe("Literal arguments; no expansion is applied"),
  cwd: z.string().default(".").describe("Workspace-relative working directory"),
  timeout_ms: z.number().int().min(1000).max(600000).default(120000),
  background: z.boolean().default(false).describe("Run as a persistent background task"),
});

export function createBashTool(
  tasks = new BackgroundTaskManager(),
  requiredChecks: readonly RequiredCheck[] = [],
  executor = new CommandExecutor(),
) {
  return defineTool({
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
      const requiredCheck = requiredCheckForCommand(
        requiredChecks,
        input.command,
        input.args,
        input.cwd,
      );
      const prepared = await executor.prepare({
        runId: context.runId,
        command: input.command,
        args: input.args,
        cwd,
        workspace: context.cwd,
      });
      const execution = {
        backend: prepared.backend,
        network: prepared.network,
        environment: "isolated" as const,
        ...(prepared.warning ? { warning: prepared.warning } : {}),
      };
      if (input.background) {
        const task = await tasks.start({
          runId: context.runId,
          command: input.command,
          args: input.args,
          cwd,
          workspace: context.cwd,
          prepared,
        });
        return {
          summary: `Started background task ${task.taskId}: ${formatCommand(input.command, input.args)}`,
          content: JSON.stringify({ ...task, execution }),
          success: true,
          execution,
        };
      }
      const startedAt = Date.now();
      const subprocess = execa(prepared.command, prepared.args, {
        cwd,
        env: prepared.env,
        extendEnv: false,
        shell: false,
        reject: false,
        all: true,
        detached: process.platform !== "win32",
        maxBuffer: 10 * 1024 * 1024,
        preferLocal: true,
        stripFinalNewline: false,
      });
      const forward = (chunk: unknown) => context.onOutput?.(String(chunk));
      subprocess.stdout?.on("data", forward);
      subprocess.stderr?.on("data", forward);
      let timedOut = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = (signal: NodeJS.Signals) => {
        if (subprocess.pid) terminateProcessTree(subprocess.pid, signal);
        subprocess.kill(signal);
      };
      const abort = () => {
        terminate("SIGTERM");
        forceTimer = setTimeout(() => terminate("SIGKILL"), 5000);
        forceTimer.unref();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        abort();
      }, requiredCheck?.timeoutMs ?? input.timeout_ms);
      timeout.unref();
      if (context.signal.aborted) {
        abort();
      } else {
        context.signal.addEventListener("abort", abort, { once: true });
      }
      try {
        const result = await subprocess;
        const exitCode = result.exitCode ?? 1;
        const command = formatCommand(input.command, input.args);
        const succeeded = !timedOut && exitCode === 0 && !result.failed && !result.timedOut;
        const output =
          (result.all?.trim() ? result.all : result.shortMessage || result.message) ?? "";
        const status =
          timedOut || result.timedOut ? "Timed out" : succeeded ? "Succeeded" : "Failed";
        const kind = classifyVerification(input.command, input.args);
        const failure = kind
          ? classifyVerificationFailure(kind, exitCode, output, timedOut || result.timedOut)
          : undefined;
        const verification: VerificationEvidence | undefined = kind
          ? {
              command,
              args: input.args,
              cwd: input.cwd,
              ...(requiredCheck ? { checkId: requiredCheck.id } : {}),
              kind,
              status:
                timedOut || result.timedOut
                  ? ("timeout" as const)
                  : succeeded
                    ? ("passed" as const)
                    : ("failed" as const),
              exitCode,
              durationMs: Date.now() - startedAt,
              ...(failure ? { failure } : {}),
            }
          : undefined;
        const content = `$ ${command}\nExecution: ${JSON.stringify(execution)}\nExit code: ${exitCode}\n${status}\n\n${output}${verification ? `\n\nVerification: ${JSON.stringify(verification)}` : ""}`;
        return {
          summary: `${status}: ${command}${succeeded ? "" : ` (exit code ${exitCode})`}`,
          ...(await boundedOutput(context, "command-output.txt", content)),
          success: succeeded,
          execution,
          ...(verification ? { verification } : {}),
        };
      } finally {
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        context.signal.removeEventListener("abort", abort);
      }
    },
  });
}

export const bashTool = createBashTool();
