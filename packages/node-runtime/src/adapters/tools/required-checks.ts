import {
  defineTool,
  type RequiredCheck,
  selectRequiredChecks,
  successfulVerification,
  type VerificationEvidence,
} from "@fidoo/core";
import { z } from "zod";
import type { WorkspaceChangeManager } from "../changes/workspace-change-manager.js";
import { createBashTool } from "./bash.js";
import { boundedOutput } from "./output.js";

export function createRequiredChecksTool(
  requiredChecks: readonly RequiredCheck[],
  changes: WorkspaceChangeManager,
) {
  const bash = createBashTool(undefined, requiredChecks);
  return defineTool({
    name: "run_required_checks",
    description:
      "Run project checks declared in .fidoo.json. Select checks affected by current-run changes by default, or provide checkIds. Returns structured evidence for every executed check.",
    inputSchema: z.object({
      checkIds: z.array(z.string().min(1)).default([]),
      onlyAffected: z.boolean().default(true),
    }),
    effect: "execute",
    risk: "medium",
    concurrency: "exclusive",
    idempotency: "never",
    execute: async (input, context) => {
      const changedFiles = new Set(
        (await changes.list(context.cwd, context.runId)).changes.map((change) => change.path),
      );
      const applicable = input.onlyAffected
        ? selectRequiredChecks(requiredChecks, changedFiles)
        : [...requiredChecks];
      const selected = input.checkIds.length
        ? applicable.filter((check) => input.checkIds.includes(check.id))
        : applicable;
      const unknown = input.checkIds.filter(
        (id) => !requiredChecks.some((check) => check.id === id),
      );
      if (unknown.length) {
        throw new Error(`Unknown required checks: ${unknown.join(", ")}`);
      }
      if (input.checkIds.length && selected.length !== input.checkIds.length) {
        throw new Error("A requested required check is not affected by current-run changes");
      }
      if (!selected.length) {
        return {
          summary: "No applicable required checks",
          content: JSON.stringify({ status: "not-required", results: [] }),
          success: true,
        };
      }
      const results: {
        id: string;
        summary: string;
        output: string;
        evidence?: VerificationEvidence;
      }[] = [];
      for (const check of selected) {
        context.onOutput?.(`\n[${check.id}]\n`);
        const result = await bash.execute(
          {
            command: check.command,
            args: check.args,
            cwd: check.cwd ?? ".",
            timeout_ms: check.timeoutMs ?? 120000,
            background: false,
          },
          context,
        );
        results.push({
          id: check.id,
          summary: result.summary,
          output: result.content,
          ...(result.verification ? { evidence: result.verification } : {}),
        });
      }
      const verifications = results
        .map((result) => result.evidence)
        .filter((evidence) => evidence !== undefined);
      const passed =
        verifications.length === selected.length && verifications.every(successfulVerification);
      const content = JSON.stringify({ status: passed ? "passed" : "failed", results }, null, 2);
      return {
        summary: `${passed ? "Passed" : "Failed"} ${selected.length} required checks`,
        ...(await boundedOutput(context, "required-checks.json", content, 48_000)),
        success: passed,
        verifications,
      };
    },
  });
}
