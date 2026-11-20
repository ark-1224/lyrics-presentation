import { useEffect, useState } from "react";
import { ControlPanel } from "./ControlPanel";
import { DisplayPage } from "./DisplayPage";

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
  if (page === "main" || page === "singers") return <DisplayPage kind={page} />;
  return <Home />;
}

/** Landing page at "/": links to the three pages plus the server health. */
function Home() {
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
      <p>Server health: {health}</p>
      <ul>
        <li><a href="/control">Control panel</a></li>
        <li><a href="/display/main">Main display (video + lyrics)</a></li>
        <li><a href="/display/singers">Singers display (lyrics only)</a></li>
      </ul>
    </main>
  );
}
