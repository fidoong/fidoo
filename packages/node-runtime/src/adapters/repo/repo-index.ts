import { open } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import fg from "fast-glob";
import { assertNotSensitive, resolveExistingPath, workspaceIgnore } from "../system/workspace.js";

const MAX_CANDIDATES = 5000;
const READ_LIMIT = 64 * 1024;

export interface RepoFileEntry {
  path: string;
  language: string;
  symbols: string[];
  imports: string[];
}

export interface RepoIndexResult {
  root: string;
  totalFiles: number;
  truncated: boolean;
  languages: Array<{ language: string; count: number }>;
  directories: Array<{ path: string; count: number }>;
  entryPoints: string[];
  tests: string[];
  files: RepoFileEntry[];
}

export async function buildRepoIndex(
  workspace: string,
  path = ".",
  maxFiles = 200,
): Promise<RepoIndexResult> {
  const workspaceRoot = await resolveExistingPath(workspace, ".");
  const root = await resolveExistingPath(workspace, path);
  const ignored = await workspaceIgnore(workspaceRoot);
  const candidates = await fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ["node_modules/**", ".git/**", "dist/**", "coverage/**"],
  });
  const visible = candidates.sort().filter((file) => {
    const workspacePath = relative(workspaceRoot, join(root, file));
    try {
      assertNotSensitive(file);
      return !ignored(workspacePath);
    } catch {
      return false;
    }
  });
  const languages = countBy(visible, (file) => languageOf(file));
  const directories = countBy(visible, (file) => dirname(file).split("/")[0] || ".");
  const selected = visible
    .toSorted((left, right) => relevance(left) - relevance(right) || left.localeCompare(right))
    .slice(0, Math.min(maxFiles, MAX_CANDIDATES));
  const files: RepoFileEntry[] = [];
  for (const file of selected) {
    const source = await readPrefix(join(root, file), READ_LIMIT);
    files.push({
      path: file,
      language: languageOf(file),
      symbols: source ? parseSymbols(file, source) : [],
      imports: source ? parseImports(file, source) : [],
    });
  }
  return {
    root: path,
    totalFiles: visible.length,
    truncated: visible.length > selected.length,
    languages: topCounts(languages, 8),
    directories: topCounts(directories, 8).map(({ language, ...entry }) => ({
      ...entry,
      path: language,
    })),
    entryPoints: visible.filter(isEntryPoint).slice(0, 20),
    tests: visible.filter(isTest).slice(0, 30),
    files,
  };
}

export function formatRepoIndex(result: RepoIndexResult): string {
  const lines = [
    `Repository root: ${result.root}`,
    `Files: ${result.totalFiles}${result.truncated ? ` (showing ${result.files.length} prioritized files)` : ""}`,
    `Languages: ${result.languages.map((entry) => `${entry.language} ${entry.count}`).join(", ") || "none"}`,
    `Top directories: ${result.directories.map((entry) => `${entry.path} ${entry.count}`).join(", ") || "none"}`,
    `Entry points: ${result.entryPoints.join(", ") || "none detected"}`,
    `Tests: ${result.tests.join(", ") || "none detected"}`,
    "",
    "Prioritized files:",
  ];
  for (const file of result.files) {
    lines.push(`${file.path} [${file.language}]`);
    if (file.symbols.length) {
      lines.push(`  symbols: ${file.symbols.join(", ")}`);
    }
    if (file.imports.length) {
      lines.push(`  imports: ${file.imports.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function parseSymbols(path: string, source: string): string[] {
  const expressions = path.endsWith(".py")
    ? [/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm]
    : [
        /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
        /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
      ];
  return unique(expressions.flatMap((expression) => matchAll(source, expression, 1))).slice(0, 8);
}

function parseImports(path: string, source: string): string[] {
  const expressions = path.endsWith(".py")
    ? [/^\s*from\s+([A-Za-z_][\w.]*)\s+import/gm, /^\s*import\s+([A-Za-z_][\w.]*)/gm]
    : [
        /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
        /\brequire\(["']([^"']+)["']\)/g,
      ];
  return unique(expressions.flatMap((expression) => matchAll(source, expression, 1))).slice(0, 12);
}

function matchAll(source: string, expression: RegExp, group: number): string[] {
  return [...source.matchAll(expression)]
    .map((match) => match[group])
    .filter((value): value is string => Boolean(value));
}

async function readPrefix(path: string, limit: number): Promise<string | undefined> {
  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(limit);
      const { bytesRead } = await handle.read(buffer, 0, limit, 0);
      const value = buffer.subarray(0, bytesRead);
      return value.includes(0) ? undefined : value.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function countBy(values: string[], key: (value: string) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = key(value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function topCounts(counts: Map<string, number>, limit: number) {
  return [...counts]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([language, count]) => ({ language, count }));
}

function relevance(path: string): number {
  if (/(^|\/)(AGENTS\.md|README|package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/.test(path))
    return 0;
  if (isEntryPoint(path)) return 1;
  if (!isTest(path)) return 2;
  return 3;
}

function isEntryPoint(path: string): boolean {
  return /(^|\/)(index|main|app|server|cli)\.(?:[cm]?[jt]sx?|py)$/.test(path);
}

function isTest(path: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(?:test|spec)\.[^/]+$/.test(path);
}

function languageOf(path: string): string {
  const extension = extname(path).toLowerCase();
  const names: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".js": "JavaScript",
    ".jsx": "JavaScript React",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".json": "JSON",
    ".md": "Markdown",
  };
  return names[extension] ?? (extension || "other");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
