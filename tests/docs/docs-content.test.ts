import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { headingId, parsePackageDocument } from "../../apps/docs/src/content/markdown.js";
import { packageDocs } from "../../apps/docs/src/content/packages.js";
import { packageHref, parseRoute } from "../../apps/docs/src/lib/router.js";
import { searchPackages } from "../../apps/docs/src/lib/search.js";

describe("Markdown documentation", () => {
  it("loads every current package from a detailed Markdown source file", () => {
    const expected = [
      "core",
      "protocol",
      "api",
      "client",
      "node-runtime",
      "tui",
      "observability",
      "cli",
      "agent-server",
      "observability-app",
      "docs",
    ];
    expect(packageDocs.map((doc) => doc.slug)).toEqual(expected);
    expect(new Set(packageDocs.map((doc) => doc.path)).size).toBe(packageDocs.length);
    for (const doc of packageDocs) {
      expect(existsSync(join(process.cwd(), doc.path))).toBe(true);
      expect(existsSync(join(process.cwd(), doc.sourcePath))).toBe(true);
      expect(doc.description.length).toBeGreaterThan(50);
      expect(doc.sections.length).toBeGreaterThanOrEqual(4);
      expect(doc.body).toContain("```");
      expect(doc.body).toContain("## 源码阅读地图");
      expect(doc.body).toContain("| 文件 |");
      expect(readFileSync(join(process.cwd(), doc.sourcePath), "utf8")).toContain(doc.description);
    }
  });

  it("searches real Markdown content and links to generated chapter anchors", () => {
    const required = searchPackages(packageDocs, "required checks");
    expect(required.some((result) => result.packageName === "@fidoo/core")).toBe(true);
    expect(required.some((result) => result.packageName === "@fidoo/node-runtime")).toBe(true);
    const source = searchPackages(packageDocs, "agent-loop.ts");
    expect(source.some((result) => result.packageName === "@fidoo/core")).toBe(true);
    expect(source[0]?.href).toContain("#/packages/core/");
    expect(searchPackages(packageDocs, "不存在的文档词条")).toEqual([]);
  });

  it("parses Frontmatter and generates Unicode-safe section links", () => {
    const doc = parsePackageDocument(
      readFileSync(join(process.cwd(), "docs/packages/core.md"), "utf8"),
      "docs/packages/core.md",
    );
    const heading = doc.headings.find((item) => item.title === "可信验证门禁");
    expect(heading).toEqual({ id: "可信验证门禁", title: "可信验证门禁" });
    expect(packageHref("core", heading?.id)).toBe(
      `#/packages/core/${encodeURIComponent("可信验证门禁")}`,
    );
    expect(parseRoute("#/packages/core/可信验证门禁")).toEqual({
      kind: "package",
      slug: "core",
      section: "可信验证门禁",
    });
    expect(headingId("RunState / EventStore")).toBe("runstate-eventstore");
  });

  it("rejects invalid package metadata instead of rendering a broken entry", () => {
    expect(() => parsePackageDocument("# Missing metadata", "broken.md")).toThrow("Frontmatter");
    expect(() =>
      parsePackageDocument(
        "---\nslug: bad\nname: bad\npath: bad\ngroup: 未知\norder: 1\nsummary: bad\ndescription: bad\n---\n\n## Body",
        "broken.md",
      ),
    ).toThrow("Invalid package group");
  });
});
