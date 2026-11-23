import type { MouseEvent, ReactNode } from "react";
import type { Theme } from "../lib/theme.js";
import { ThemeToggle } from "./theme-toggle.js";
import { Icon } from "./ui.js";

export function AppShell({
  children,
  navigate,
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  navigate: (path: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const openRuns = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    navigate("/runs");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <a className="brand" href="/runs" onClick={openRuns}>
            <span className="brand-mark">ƒ</span>
            <span>fidoo</span>
            <span className="brand-product">observe</span>
          </a>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <nav className="navigation" aria-label="Primary navigation">
          <span className="nav-label">WORKSPACE</span>
          <a className="nav-item active" href="/runs" onClick={openRuns}>
            <Icon name="pulse" />
            Runs
            <span className="nav-count">LIVE</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <span /> Local data source
          </div>
          <div className="read-only">
            <Icon name="terminal" /> Read-only inspector
          </div>
          <span className="version">FIDOO OBSERVE / 0.1</span>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
