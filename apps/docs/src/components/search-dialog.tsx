import { useEffect, useMemo, useRef, useState } from "react";
import { packageDocs } from "../content/packages.js";
import { searchPackages } from "../lib/search.js";
import { Icon } from "./icon.js";

export function SearchDialog({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchPackages(packageDocs, query), [query]);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const openResult = (href: string) => {
    window.location.hash = href;
    onClose();
  };

  return (
    <div className="search-overlay">
      <button type="button" className="search-backdrop" aria-label="关闭搜索" onClick={onClose} />
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索工程手册">
        <div className="search-input-row">
          <Icon name="search" size={21} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, results.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && results[selected]) {
                openResult(results[selected].href);
              }
            }}
            placeholder="搜索包、概念、方法或源码文件…"
            aria-label="搜索文档"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-caption">
          <span>{query ? `${results.length} 条匹配结果` : "浏览全部包"}</span>
          <span>↑↓ 选择 · Enter 打开</span>
        </div>
        <div className="search-results">
          {results.length ? (
            results.map((result, index) => (
              <a
                href={result.href}
                className={`search-result ${selected === index ? "is-selected" : ""}`}
                key={result.id}
                onMouseEnter={() => setSelected(index)}
                onClick={onClose}
              >
                <span className="result-marker">
                  <Icon name="arrow" size={16} />
                </span>
                <span className="result-copy">
                  <strong>{result.title}</strong>
                  <span>{result.context}</span>
                </span>
                <small>{result.packageName}</small>
              </a>
            ))
          ) : (
            <div className="search-empty">
              <span>没有匹配内容</span>
              <p>试试 “事件”、“审批”、“verification” 或 “agent-loop.ts”。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
