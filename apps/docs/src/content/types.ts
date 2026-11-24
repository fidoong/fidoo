export type PackageGroup = "核心与协议" | "运行与基础设施" | "客户端与应用";

export interface DocHeading {
  id: string;
  title: string;
}

export interface MarkdownSection extends DocHeading {
  content: string;
}

export interface PackageDoc {
  slug: string;
  name: string;
  path: string;
  group: PackageGroup;
  order: number;
  summary: string;
  description: string;
  keywords: string[];
  dependencies: string[];
  sourcePath: string;
  body: string;
  headings: DocHeading[];
  sections: MarkdownSection[];
}
