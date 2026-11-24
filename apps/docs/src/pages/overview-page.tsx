import { ArchitectureMap } from "../components/architecture-map.js";
import { Icon } from "../components/icon.js";
import { MarkdownView } from "../components/markdown.js";
import { packageDocs, packageGroups } from "../content/packages.js";
import { projectMarkdown } from "../content/project.js";

export function OverviewPage({ onSearch }: { onSearch(): void }) {
  return (
    <div className="overview-page">
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow">
            <span>FIDOO</span> ENGINEERING HANDBOOK <i>2026</i>
          </div>
          <h1>
            把一个编码 Agent，
            <br />
            <em>拆成清晰的边界。</em>
          </h1>
          <p>
            从一次终端输入，到模型、工具、审批与真实验证。这里记录 Fidoo
            的整体架构、每个包的实现方式，以及扩展时必须守住的设计约束。
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#architecture">
              阅读系统架构 <Icon name="arrow" />
            </a>
            <button className="text-action" type="button" onClick={onSearch}>
              <Icon name="search" size={17} /> 搜索实现细节 <kbd>⌘K</kbd>
            </button>
          </div>
        </div>
        <figure className="hero-specimen" aria-label="运行链路摘要">
          <div className="specimen-top">
            <span>RUN LIFECYCLE</span>
            <span className="specimen-status">VERIFIED</span>
          </div>
          <div className="specimen-glyph">ƒ</div>
          <div className="specimen-flow">
            <span>run.start</span>
            <i>→</i>
            <span>tools</span>
            <i>→</i>
            <span>verify</span>
            <i>→</i>
            <strong>completed</strong>
          </div>
          <div className="specimen-meta">
            <div>
              <strong>{packageDocs.length}</strong>
              <span>workspace packages</span>
            </div>
            <div>
              <strong>v1</strong>
              <span>public protocol</span>
            </div>
            <div>
              <strong>1</strong>
              <span>canonical event log</span>
            </div>
          </div>
        </figure>
        <div className="hero-footnote">
          DESIGNED FOR LOCAL AI PROGRAMMING <span>·</span> BUILT IN TYPESCRIPT
        </div>
      </section>

      <section className="overview-section architecture-section" id="architecture">
        <SectionHeading
          index="01"
          kicker="SYSTEM TOPOLOGY"
          title="架构不是一张依赖图，而是一组承诺。"
        />
        <div className="section-intro">
          <p>
            界面可以替换，传输可以替换，Provider 也可以替换；任务事实、权限和验证语义不随界面改变。
          </p>
          <span>点击节点进入对应实现文档</span>
        </div>
        <ArchitectureMap />
        <div className="boundary-note">
          <span className="boundary-label">DEPENDENCY RULE</span>
          <code>apps → client → protocol</code>
          <code>agent-server → api → core ← node-runtime</code>
          <p>禁止 core 依赖界面，禁止 client 携带 Node 工具，禁止 TUI 绕过 API。</p>
        </div>
      </section>

      <section className="overview-section package-index-section">
        <SectionHeading index="02" kicker="PACKAGE INDEX" title="按职责阅读，而不是按文件迷路。" />
        <div className="package-index">
          {packageGroups.map((group) => (
            <div className="package-index-group" key={group}>
              <h3>
                {group}
                <span>{packageDocs.filter((doc) => doc.group === group).length}</span>
              </h3>
              {packageDocs
                .filter((doc) => doc.group === group)
                .map((doc) => (
                  <a href={`#/packages/${doc.slug}`} className="package-index-card" key={doc.slug}>
                    <div className="package-card-top">
                      <code>{doc.name}</code>
                      <Icon name="arrow" size={17} />
                    </div>
                    <p>{doc.summary}</p>
                    <small>{doc.path}</small>
                  </a>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="overview-section project-document-section">
        <div className="project-document-label">
          <span>03</span>
          <small>PROJECT NOTES</small>
          <code>docs/project.md</code>
        </div>
        <MarkdownView source={projectMarkdown} />
      </section>

      <footer className="page-footer">
        <span>FIDOO / ENGINEERING HANDBOOK</span>
        <span>读实现，也读边界。</span>
      </footer>
    </div>
  );
}

function SectionHeading({
  index,
  kicker,
  title,
}: {
  index: string;
  kicker: string;
  title: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span>{index}</span>
        <small>{kicker}</small>
      </div>
      <h2>{title}</h2>
    </div>
  );
}
