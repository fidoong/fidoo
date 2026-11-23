import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  AgentError,
  errorMessage,
  permissionConfigSchema,
  type ResolvedPermissionPolicy,
} from "@fidoo/core";

export interface LoadPermissionPolicyOptions {
  cwd: string;
  dataHome: string;
  policyFile?: string;
}

export async function loadPermissionPolicy(
  options: LoadPermissionPolicyOptions,
): Promise<ResolvedPermissionPolicy> {
  const candidates = [
    {
      path: resolve(options.dataHome, "policy.json"),
      label: "global policy",
      required: false,
      trusted: true,
    },
    {
      path: resolve(options.cwd, "fidoo.policy.json"),
      label: "project policy",
      required: false,
      trusted: false,
    },
    ...(options.policyFile
      ? [
          {
            path: resolve(options.cwd, options.policyFile),
            label: `explicit policy ${basename(options.policyFile)}`,
            required: true,
            trusted: true,
          },
        ]
      : []),
  ];
  const uniqueCandidates = [
    ...new Map(candidates.map((candidate) => [candidate.path, candidate])).values(),
  ];
  const resolved: ResolvedPermissionPolicy = { mode: undefined, rules: [], sources: [] };
  for (const candidate of uniqueCandidates) {
    let source: string;
    try {
      source = await readFile(candidate.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !candidate.required) {
        continue;
      }
      throw new AgentError(
        `Cannot read permission config ${candidate.path}: ${errorMessage(error)}`,
        "configuration",
      );
    }
    try {
      const config = permissionConfigSchema.parse(JSON.parse(source));
      if (
        !candidate.trusted &&
        (config.mode === "auto" || config.rules.some((rule) => rule.action === "allow"))
      ) {
        throw new Error(
          "Project policies can only restrict access; allow rules and auto mode require a trusted user config",
        );
      }
      if (config.mode) {
        resolved.mode = config.mode;
      }
      resolved.rules.push(...config.rules.map((rule) => ({ ...rule, source: candidate.label })));
      resolved.sources.push(candidate.path);
    } catch (error) {
      throw new AgentError(
        `Invalid permission config ${candidate.path}: ${errorMessage(error)}`,
        "configuration",
      );
    }
  }
  return resolved;
}
