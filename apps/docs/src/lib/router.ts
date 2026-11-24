export type Route = { kind: "overview" } | { kind: "package"; slug: string; section?: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "packages" || !parts[1]) return { kind: "overview" };
  return {
    kind: "package",
    slug: decodeURIComponent(parts[1]),
    ...(parts[2] ? { section: decodeURIComponent(parts[2]) } : {}),
  };
}

export function packageHref(slug: string, section?: string): string {
  return `#/packages/${encodeURIComponent(slug)}${section ? `/${encodeURIComponent(section)}` : ""}`;
}
