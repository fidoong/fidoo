import { useEffect, useState } from "react";
import { AppShell } from "./components/app-shell.js";
import { RunDetailPage } from "./features/runs/run-detail-page.js";
import { RunsPage } from "./features/runs/runs-page.js";
import { useTheme } from "./lib/theme.js";

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const { theme, toggleTheme } = useTheme();
  useEffect(() => {
    const update = () => {
      setPath(window.location.pathname);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0 });
  };
  const runId = /^\/runs\/([A-Za-z0-9_-]+)\/?$/.exec(path)?.[1];

  return (
    <AppShell navigate={navigate} theme={theme} onToggleTheme={toggleTheme}>
      {runId ? (
        <RunDetailPage key={runId} runId={runId} navigate={navigate} />
      ) : (
        <RunsPage navigate={navigate} />
      )}
    </AppShell>
  );
}
