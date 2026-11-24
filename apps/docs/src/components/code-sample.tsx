import { useState } from "react";
import { Icon } from "./icon.js";

export function CodeSample({
  code,
  language,
  title,
}: {
  code: string;
  language: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <figure className="code-sample">
      <figcaption>
        <span className="code-language">{language || "text"}</span>
        <span>{title}</span>
        <button type="button" onClick={copy} aria-label={`复制${title}`}>
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? "已复制" : "复制"}
        </button>
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
