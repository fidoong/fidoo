import { Icon } from "../components/icon.js";
import { MarkdownView } from "../components/markdown.js";
import { packageDocs } from "../content/packages.js";
import type { PackageDoc } from "../content/types.js";
import { packageHref } from "../lib/router.js";

export function PackagePage({ doc, activeSection }: { doc: PackageDoc; activeSection?: string }) {
  const index = packageDocs.findIndex((item) => item.slug === doc.slug);
  const previous = packageDocs[index - 1];
  const next = packageDocs[index + 1];
  return (
    <article className="package-page">
      <header className="package-hero">
        <div className="package-breadcrumb">
          <a href="#/">工程手册</a>
          <span>/</span>
          <span>{doc.group}</span>
        </div>
        <div className="package-number">{String(index + 1).padStart(2, "0")}</div>
        <div className="package-title-row">
          <div>
            <code className="package-path">{doc.path}</code>
            <h1>{doc.name}</h1>
          </div>
          <span className="package-group-badge">{doc.group}</span>
        </div>
        <p className="package-lede">{doc.description}</p>
        <div className="package-tags">
          {doc.keywords.map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      </header>

      <div className="package-content-layout">
        <div className="package-content">
          <MarkdownView source={doc.body} />
          <section className="dependency-section">
            <h2>声明依赖</h2>
            <div>
              {doc.dependencies.map((dependency) => (
                <code key={dependency}>{dependency}</code>
              ))}
            </div>
          </section>
          <div className="document-source">
            <span>CONTENT SOURCE</span>
            <code>{doc.sourcePath}</code>
          </div>
        </div>

        <aside className="on-this-page">
          <span>本页内容</span>
          <nav>
            {doc.headings.map((heading) => (
              <a
                className={activeSection === heading.id ? "is-active" : ""}
                href={packageHref(doc.slug, heading.id)}
                key={heading.id}
              >
                {heading.title}
              </a>
            ))}
          </nav>
          <div className="on-page-meta">
            <span>PACKAGE</span>
            <code>{doc.name}</code>
            <span>DIRECTORY</span>
            <code>{doc.path}</code>
          </div>
        </aside>
      </div>

      <nav className="package-pagination" aria-label="相邻包文档">
        {previous ? (
          <a href={packageHref(previous.slug)}>
            <small>← 上一个包</small>
            <strong>{previous.name}</strong>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={packageHref(next.slug)} className="next-package">
            <small>
              下一个包 <Icon name="arrow" size={14} />
            </small>
            <strong>{next.name}</strong>
          </a>
        ) : (
          <a href="#/" className="next-package">
            <small>返回</small>
            <strong>项目总览</strong>
          </a>
        )}
      </nav>
    </article>
  );
}
