import { useEffect, useState } from "react";
import { ControlPanel } from "./ControlPanel";

// Only three fixed pages, so a simple path switch is enough (no router library needed).
type Page = "control" | "main" | "singers" | "home";

function pageFromPath(pathname: string): Page {
  if (pathname.startsWith("/control")) return "control";
  if (pathname.startsWith("/display/main")) return "main";
  if (pathname.startsWith("/display/singers")) return "singers";
  return "home";
}

export function App() {
  const page = pageFromPath(window.location.pathname);
  if (page === "control") return <ControlPanel />;
  return <Placeholder page={page} />;
}

/** Display pages arrive in step (c); until then they just prove routing + health work. */
function Placeholder({ page }: { page: Page }) {
  const [health, setHealth] = useState<string>("checking...");

  useEffect(() => {
    fetch("/healthz")
      .then((r) => r.json())
      .then((j: { status: string }) => setHealth(j.status))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <main className="placeholder">
      <h1>Lyric Presenter</h1>
      <p>Page: {page}</p>
      <p>Server health: {health}</p>
      {page === "home" && (
        <ul>
          <li><a href="/control">/control</a></li>
          <li><a href="/display/main">/display/main</a></li>
          <li><a href="/display/singers">/display/singers</a></li>
        </ul>
      )}
    </main>
  );
}
