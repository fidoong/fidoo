import { parsePackageDocument } from "./markdown.js";
import type { PackageDoc } from "./types.js";

const documents = import.meta.glob("../../../../docs/packages/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const packageDocs: PackageDoc[] = Object.entries(documents)
  .map(([path, source]) =>
    parsePackageDocument(source, `docs/packages/${path.split("/").at(-1) ?? "unknown.md"}`),
  )
  .sort((left, right) => left.order - right.order);

export const packageGroups = ["核心与协议", "运行与基础设施", "客户端与应用"] as const;

export function findPackage(slug: string): PackageDoc | undefined {
  return packageDocs.find((doc) => doc.slug === slug);
}
