import { packageDocs, packageGroups } from "../content/packages.js";
import { Icon } from "./icon.js";

export function Sidebar({
  currentSlug,
  mobileOpen,
  onClose,
  onSearch,
}: {
  currentSlug?: string;
  mobileOpen: boolean;
  onClose(): void;
  onSearch(): void;
}) {
  const goHome = () => {
    window.location.hash = "/";
    onClose();
  };
  return (
    <>
      <button
        type="button"
        className={`sidebar-scrim ${mobileOpen ? "is-open" : ""}`}
        aria-label="关闭导航"
        onClick={onClose}
      />
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="brand-row">
          <button
            type="button"
            className="docs-brand"
            aria-label="Fidoo 工程手册首页"
            onClick={goHome}
          >
            <span className="brand-glyph">ƒ</span>
            <span className="brand-word">fidoo</span>
            <span className="brand-edition">DOCS</span>
          </button>
          <button type="button" className="mobile-close" aria-label="关闭导航" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <button type="button" className="sidebar-search" onClick={onSearch}>
          <Icon name="search" size={16} />
          <span>搜索文档</span>
          <kbd>⌘ K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="包文档导航">
          <button
            type="button"
            className={`overview-link ${!currentSlug ? "is-active" : ""}`}
            onClick={goHome}
          >
            <span className="nav-index">00</span>
            <span>项目总览</span>
            <Icon name="arrow" size={15} />
          </button>
          {packageGroups.map((group, groupIndex) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-label">
                <span>0{groupIndex + 1}</span>
                {group}
              </div>
              {packageDocs
                .filter((doc) => doc.group === group)
                .map((doc) => (
                  <a
                    href={`#/packages/${doc.slug}`}
                    className={`package-link ${currentSlug === doc.slug ? "is-active" : ""}`}
                    key={doc.slug}
                    onClick={onClose}
                  >
                    <span>{doc.name.replace("@fidoo/", "")}</span>
                    <span className="package-dot" />
                  </a>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="live-mark" />
          <span>Protocol v1</span>
          <span className="footer-separator">/</span>
          <span>Node 22+</span>
        </div>
      </aside>
    </>
  );
}
