import { Lexer, type Token, type Tokens } from "marked";
import { memo, type ReactNode, useMemo } from "react";
import { headingId } from "../content/markdown.js";
import { CodeSample } from "./code-sample.js";

export const MarkdownView = memo(function MarkdownView({ source }: { source: string }) {
  const tokens = useMemo(() => Lexer.lex(source, { gfm: true, breaks: false }), [source]);
  const keys = new Map<string, number>();
  return (
    <div className="markdown-document">
      {tokens.map((token) => renderBlock(token, nextKey(keys, `${token.type}-${token.raw}`)))}
    </div>
  );
});

function renderBlock(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const content = renderInline(token.tokens ?? []);
      const id = token.depth === 2 ? headingId(token.text) : undefined;
      if (token.depth === 1) return <h1 key={key}>{content}</h1>;
      if (token.depth === 2)
        return (
          <h2 id={id} key={key}>
            {content}
          </h2>
        );
      if (token.depth === 3) return <h3 key={key}>{content}</h3>;
      return <h4 key={key}>{content}</h4>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(token.tokens ?? [])}</p>;
    case "text":
      return <p key={key}>{renderInline(token.tokens ?? Lexer.lexInline(token.text))}</p>;
    case "code":
      return (
        <CodeSample key={key} code={token.text} language={token.lang ?? "text"} title="代码示例" />
      );
    case "list": {
      const list = token as Tokens.List;
      const itemKeys = new Map<string, number>();
      const items = list.items.map((item) =>
        renderListItem(item, list, nextKey(itemKeys, item.raw)),
      );
      return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "blockquote": {
      const quoteKeys = new Map<string, number>();
      return (
        <blockquote key={key}>
          {(token.tokens ?? []).map((child) => renderBlock(child, nextKey(quoteKeys, child.raw)))}
        </blockquote>
      );
    }
    case "hr":
      return <hr key={key} />;
    case "table": {
      const table = token as Tokens.Table;
      const rowKeys = new Map<string, number>();
      return (
        <div className="table-scroll" key={key}>
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th style={{ textAlign: cell.align ?? "left" }} key={cell.text || index}>
                    {renderInline(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={nextKey(rowKeys, JSON.stringify(row))}>
                  {row.map((cell, index) => (
                    <td style={{ textAlign: cell.align ?? "left" }} key={cell.text || index}>
                      {renderInline(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "html":
      return (
        <pre className="raw-html" key={key}>
          {token.text}
        </pre>
      );
    default:
      return <p key={key}>{token.raw}</p>;
  }
}

function renderListItem(item: Tokens.ListItem, list: Tokens.List, key: string): ReactNode {
  const childKeys = new Map<string, number>();
  return (
    <li key={key}>
      {item.task ? <input type="checkbox" checked={item.checked} disabled /> : null}
      {list.ordered ? null : <span className="list-marker" aria-hidden="true" />}
      <div className="list-item-content">
        {item.tokens.map((token) => {
          const childKey = nextKey(childKeys, token.raw);
          return token.type === "text" || token.type === "paragraph" ? (
            <p key={childKey}>{renderInline(token.tokens ?? Lexer.lexInline(token.text))}</p>
          ) : (
            renderBlock(token, childKey)
          );
        })}
      </div>
    </li>
  );
}

function renderInline(tokens: Token[]): ReactNode[] {
  const keys = new Map<string, number>();
  return tokens.map((token) => {
    const key = nextKey(keys, `${token.type}-${token.raw}`);
    switch (token.type) {
      case "strong":
        return <strong key={key}>{renderInline(token.tokens ?? [])}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.tokens ?? [])}</em>;
      case "codespan":
        return <code key={key}>{token.text}</code>;
      case "link": {
        const external = /^https?:\/\//.test(token.href);
        return (
          <a
            href={token.href}
            key={key}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {renderInline(token.tokens ?? [])}
          </a>
        );
      }
      case "image":
        return <img key={key} src={token.href} alt={token.text} loading="lazy" />;
      case "del":
        return <del key={key}>{renderInline(token.tokens ?? [])}</del>;
      case "br":
        return <br key={key} />;
      case "escape":
        return token.text;
      case "text":
        return token.tokens ? renderInline(token.tokens) : token.text;
      case "html":
        return <code key={key}>{token.text}</code>;
      default:
        return <span key={key}>{token.raw}</span>;
    }
  });
}

function nextKey(keys: Map<string, number>, value: string): string {
  const base = value.slice(0, 64);
  const occurrence = (keys.get(base) ?? 0) + 1;
  keys.set(base, occurrence);
  return `${base}-${occurrence}`;
}
