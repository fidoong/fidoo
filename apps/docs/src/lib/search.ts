import type { PackageDoc } from "../content/types.js";
import { packageHref } from "./router.js";

export interface SearchResult {
  id: string;
  title: string;
  context: string;
  packageName: string;
  href: string;
}

export function searchPackages(packages: PackageDoc[], query: string): SearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];
  for (const doc of packages) {
    const overview = [doc.name, doc.path, doc.summary, doc.description, ...doc.keywords].join(" ");
    if (matches(overview, terms)) {
      results.push({
        id: doc.slug,
        title: doc.name,
        context: doc.summary,
        packageName: doc.group,
        href: packageHref(doc.slug),
      });
    }
    for (const section of doc.sections) {
      if (terms.length > 0 && matches(section.content, terms)) {
        results.push({
          id: `${doc.slug}/${section.id}`,
          title: section.title,
          context: sectionSummary(section.content),
          packageName: doc.name,
          href: packageHref(doc.slug, section.id),
        });
      }
    }
  }
  return results.slice(0, 12);
}

function sectionSummary(content: string): string {
  const paragraph = content
    .replace(/^##\s+.+$/m, "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("```") && !part.startsWith("|"));
  return (paragraph ?? "查看章节实现")
    .replace(/[`*_#|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function matches(content: string, terms: string[]): boolean {
  const normalized = content.toLocaleLowerCase();
  return terms.every((term) => normalized.includes(term));
}
