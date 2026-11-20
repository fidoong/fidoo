export function isVerificationCommand(command: string, args: string[]): boolean {
  const executable = command.split("/").at(-1) ?? command;
  const joined = args.join(" ");
  if (["pnpm", "npm", "yarn", "bun"].includes(executable)) {
    return /(^|\s)(run\s+)?(test|build|typecheck|lint|check)(\s|$)/.test(joined);
  }
  if (["npx", "pnpx"].includes(executable)) {
    return /(^|\s)(tsc|vitest|jest|eslint|biome)(\s|$)/.test(joined);
  }
  if (executable === "node") {
    return args.includes("--test");
  }
  if (executable === "python" || executable === "python3") {
    return joined.includes("pytest") || joined.includes("unittest");
  }
  if (executable === "pytest" || executable === "tsc" || executable === "vitest") {
    return true;
  }
  if (executable === "go") {
    return args[0] === "test" || args[0] === "vet";
  }
  if (executable === "cargo") {
    return args[0] === "test" || args[0] === "check" || args[0] === "clippy";
  }
  return executable === "make" && ["test", "check", "verify"].includes(args[0] ?? "");
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}
