import type { ReactNode } from "react";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

export function Icon({ name }: { name: "arrow" | "search" | "pulse" | "check" | "terminal" }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    pulse: (
      <>
        <path d="M3 12h4l2-7 4 14 2-7h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    terminal: (
      <>
        <path d="m5 7 5 5-5 5" />
        <path d="M13 17h6" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-glyph">ƒ</div>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
