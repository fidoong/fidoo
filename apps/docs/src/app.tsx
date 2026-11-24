import { useEffect, useState } from "react";
import { Icon } from "./components/icon.js";
import { SearchDialog } from "./components/search-dialog.js";
import { Sidebar } from "./components/sidebar.js";
import { findPackage } from "./content/packages.js";
import { parseRoute } from "./lib/router.js";
import { OverviewPage } from "./pages/overview-page.js";
import { PackagePage } from "./pages/package-page.js";

export function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const doc = route.kind === "package" ? findPackage(route.slug) : undefined;

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, [contenteditable=true]");
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "/" && !editing && !searchOpen) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    document.title = doc ? `${doc.name} · Fidoo 工程手册` : "Fidoo 工程手册";
    if (route.kind === "package" && route.section) {
      window.requestAnimationFrame(() => {
        document.getElementById(route.section ?? "")?.scrollIntoView({ block: "start" });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [route, doc]);

  return (
    <div className="docs-app">
      <a href="#main-content" className="skip-link">
        跳到正文
      </a>
      <Sidebar
        {...(doc ? { currentSlug: doc.slug } : {})}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onSearch={() => setSearchOpen(true)}
      />
      <header className="mobile-header">
        <button type="button" aria-label="打开导航" onClick={() => setMobileOpen(true)}>
          <Icon name="menu" />
        </button>
        <a href="#/">
          <span>ƒ</span> fidoo <small>DOCS</small>
        </a>
        <button type="button" aria-label="搜索文档" onClick={() => setSearchOpen(true)}>
          <Icon name="search" />
        </button>
      </header>
      <main id="main-content" className="docs-main">
        {route.kind === "overview" ? <OverviewPage onSearch={() => setSearchOpen(true)} /> : null}
        {route.kind === "package" && doc ? (
          <PackagePage doc={doc} {...(route.section ? { activeSection: route.section } : {})} />
        ) : null}
        {route.kind === "package" && !doc ? (
          <section className="not-found">
            <span>404 / UNKNOWN PACKAGE</span>
            <h1>这份文档还没有归档。</h1>
            <p>链接中的包名不存在，或文档内容尚未加入索引。</p>
            <a href="#/">
              返回项目总览 <Icon name="arrow" />
            </a>
          </section>
        ) : null}
      </main>
      {searchOpen ? <SearchDialog onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
}
