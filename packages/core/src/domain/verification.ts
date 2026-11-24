export type VerificationKind = "test" | "typecheck" | "lint" | "build" | "check";
export type VerificationStatus = "passed" | "failed" | "timeout";
export type VerificationFailure = VerificationKind | "environment" | "timeout" | "command";

export interface RequiredCheck {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  paths?: string[];
}

export interface VerificationEvidence {
  command: string;
  exitCode: number;
  kind: VerificationKind;
  status: VerificationStatus;
  durationMs: number;
  seq?: number;
  args?: string[];
  cwd?: string;
  checkId?: string;
  failure?: VerificationFailure;
}

export function classifyVerification(
  command: string,
  args: string[],
): VerificationKind | undefined {
  const executable = command.split("/").at(-1) ?? command;
  if (["pnpm", "npm", "yarn", "bun"].includes(executable)) {
    const script = packageManagerScript(args);
    return script ? scriptKind(script) : undefined;
  }
  if (["npx", "pnpx"].includes(executable)) {
    return args[0] ? scriptKind(args[0]) : undefined;
  }
  if (executable === "node") {
    return args.includes("--test") ? "test" : undefined;
  }
  if (executable === "python" || executable === "python3") {
    return args.includes("pytest") || args.includes("unittest") ? "test" : undefined;
  }
  if (["pytest", "vitest", "jest", "mocha", "ava"].includes(executable)) {
    return "test";
  }
  if (executable === "tsc") {
    return "typecheck";
  }
  if (["eslint", "biome", "prettier", "stylelint"].includes(executable)) {
    return "lint";
  }
  if (["vite", "tsup", "webpack", "rollup"].includes(executable)) {
    return "build";
  }
  if (executable === "go") {
    return args[0] === "test" ? "test" : args[0] === "vet" ? "lint" : undefined;
  }
  if (executable === "cargo") {
    if (args[0] === "test") return "test";
    if (args[0] === "clippy") return "lint";
    if (args[0] === "check" || args[0] === "build") return "build";
  }
  if (executable === "make") {
    if (args[0] === "test") return "test";
    if (["check", "verify"].includes(args[0] ?? "")) return "check";
  }
  return undefined;
}

export function isVerificationCommand(command: string, args: string[]): boolean {
  return classifyVerification(command, args) !== undefined;
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export function successfulVerification(evidence: VerificationEvidence): boolean {
  return evidence.status === "passed" || (evidence.status === undefined && evidence.exitCode === 0);
}

export function verificationMatchesCheck(
  evidence: VerificationEvidence,
  check: RequiredCheck,
): boolean {
  if (evidence.checkId) {
    return evidence.checkId === check.id;
  }
  return (
    evidence.command === formatCommand(check.command, check.args) &&
    normalizeCwd(evidence.cwd) === normalizeCwd(check.cwd)
  );
}

export function requiredCheckForCommand(
  checks: readonly RequiredCheck[],
  command: string,
  args: string[],
  cwd: string,
): RequiredCheck | undefined {
  return checks.find(
    (check) =>
      check.command === command &&
      check.args.length === args.length &&
      check.args.every((arg, index) => arg === args[index]) &&
      normalizeCwd(check.cwd) === normalizeCwd(cwd),
  );
}

export function selectRequiredChecks(
  checks: readonly RequiredCheck[],
  changedFiles: ReadonlySet<string>,
): RequiredCheck[] {
  return checks.filter(
    (check) =>
      !check.paths?.length ||
      [...changedFiles].some((file) =>
        check.paths?.some((pattern) => matchesGlob(normalizeFile(file), pattern)),
      ),
  );
}

export function classifyVerificationFailure(
  kind: VerificationKind,
  exitCode: number,
  output: string,
  timedOut: boolean,
): VerificationFailure | undefined {
  if (timedOut) return "timeout";
  if (exitCode === 0) return undefined;
  if (
    exitCode === 126 ||
    exitCode === 127 ||
    /(?:command not found|ENOENT|Cannot find module|ModuleNotFoundError|No module named|could not determine which toolchain)/i.test(
      output,
    )
  ) {
    return "environment";
  }
  return kind === "check" ? "command" : kind;
}

export function formatVerificationEvidence(evidence: VerificationEvidence): string {
  const name = evidence.checkId ?? evidence.kind;
  const duration = evidence.durationMs === undefined ? "" : `, ${evidence.durationMs}ms`;
  return `${name}: ${evidence.status ?? (evidence.exitCode === 0 ? "passed" : "failed")} (${evidence.command}, exit ${evidence.exitCode}${duration})`;
}

function packageManagerScript(args: string[]): string | undefined {
  if (args[0] === "run") return args[1];
  if (args[0] === "exec" || args[0] === "dlx") return args[1];
  return args[0];
}

function scriptKind(script: string): VerificationKind | undefined {
  if (["test", "test:unit", "test:integration", "test:e2e"].includes(script)) return "test";
  if (["typecheck", "type-check", "tsc"].includes(script)) return "typecheck";
  if (["lint", "eslint", "biome", "format:check"].includes(script)) return "lint";
  if (["build", "compile", "vite", "tsup", "webpack", "rollup"].includes(script)) return "build";
  if (["check", "verify", "validate"].includes(script)) return "check";
  if (["vitest", "jest", "mocha", "ava", "pytest"].includes(script)) return "test";
  return undefined;
}

function normalizeCwd(cwd: string | undefined): string {
  const normalized = (cwd ?? ".").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalized || ".";
}

function normalizeFile(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function matchesGlob(file: string, pattern: string): boolean {
  const normalized = normalizeFile(pattern);
  const source = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${source}$`).test(file);
}
