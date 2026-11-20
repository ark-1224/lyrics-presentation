import { useEffect, useState } from "react";

// Only three fixed pages, so a simple path switch is enough (no router library needed).
type Page = "control" | "main" | "singers" | "home";

function pageFromPath(pathname: string): Page {
  if (pathname.startsWith("/control")) return "control";
  if (pathname.startsWith("/display/main")) return "main";
  if (pathname.startsWith("/display/singers")) return "singers";
  return "home";
}

/** Placeholder shell for step (a): proves the build, routing and health check work end to end. */
export function App() {
  const page = pageFromPath(window.location.pathname);
  const [health, setHealth] = useState<string>("checking...");

  useEffect(() => {
    fetch("/healthz")
      .then((r) => r.json())
      .then((j: { status: string }) => setHealth(j.status))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
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
