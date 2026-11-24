import { Lexer } from "marked";
import type { PackageDoc, PackageGroup } from "./types.js";

const groups: PackageGroup[] = ["核心与协议", "运行与基础设施", "客户端与应用"];

export function parsePackageDocument(source: string, sourcePath: string): PackageDoc {
  const { data, body } = parseFrontmatter(source);
  const group = required(data, "group", sourcePath) as PackageGroup;
  if (!groups.includes(group)) throw new Error(`Invalid package group in ${sourcePath}: ${group}`);
  const order = Number(required(data, "order", sourcePath));
  if (!Number.isInteger(order)) throw new Error(`Invalid package order in ${sourcePath}`);
  const headings = extractHeadings(body);
  return {
    slug: required(data, "slug", sourcePath),
    name: required(data, "name", sourcePath),
    path: required(data, "path", sourcePath),
    group,
    order,
    summary: required(data, "summary", sourcePath),
    description: required(data, "description", sourcePath),
    keywords: list(data, "keywords"),
    dependencies: list(data, "dependencies"),
    sourcePath,
    body,
    headings,
    sections: splitSections(body, headings),
  };
}

export function headingId(title: string): string {
  return title
    .trim()
    .toLocaleLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

export function extractHeadings(body: string) {
  const used = new Map<string, number>();
  return Lexer.lex(body, { gfm: true })
    .filter((token) => token.type === "heading" && token.depth === 2)
    .map((token) => {
      if (token.type !== "heading") throw new Error("Unexpected heading token");
      const base = headingId(token.text);
      const occurrence = (used.get(base) ?? 0) + 1;
      used.set(base, occurrence);
      return { id: occurrence === 1 ? base : `${base}-${occurrence}`, title: token.text };
    });
}

function splitSections(body: string, headings: { id: string; title: string }[]) {
  const parts = body.split(/(?=^##\s+)/m).filter((part) => /^##\s+/m.test(part));
  return parts.map((content, index) => {
    const title = content.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? `Section ${index + 1}`;
    return { id: headings[index]?.id ?? headingId(title), title, content };
  });
}

function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Package document must start with Frontmatter");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("Unclosed Frontmatter");
  const data: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid Frontmatter line: ${line}`);
    data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { data, body: normalized.slice(end + 5).trim() };
}

function required(data: Record<string, string>, key: string, sourcePath: string): string {
  const value = data[key]?.trim();
  if (!value) throw new Error(`Missing ${key} in ${sourcePath}`);
  return unquote(value);
}

function list(data: Record<string, string>, key: string): string[] {
  return (data[key] ?? "")
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}
