import { useEffect } from "react";
import { useState } from "react";
import type { ReactNode } from "react";

type Health =
  | { state: "checking" }
  | { state: "ok"; persistent: boolean }
  | { state: "storage-problem" }
  | { state: "down" };

/** Asks the server's health check once, so the page can say whether everything is working. */
function useHealth(): Health {
  const [health, setHealth] = useState<Health>({ state: "checking" });
  useEffect(() => {
    fetch("/healthz")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { persistentStorage?: boolean };
        setHealth(res.ok ? { state: "ok", persistent: body.persistentStorage !== false } : { state: "storage-problem" });
      })
      .catch(() => setHealth({ state: "down" }));
  }, []);
  return health;
}

function StatusPill({ health }: { health: Health }) {
  const label =
    health.state === "checking" ? "Checking…" : health.state === "ok" ? "Server online" : health.state === "storage-problem" ? "Storage problem" : "Can't reach the server";
  const tone = health.state === "ok" ? "ok" : health.state === "checking" ? "wait" : "bad";
  return (
    <span className={`home-status ${tone}`} role="status">
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}

// Simple line icons (inherit the text colour so they follow light/dark mode).
const icon = (children: ReactNode) => (
  <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const ControlIcon = () =>
  icon(
    <>
      <rect x="6" y="8" width="36" height="32" rx="5" />
      <path d="M6 18h36" />
      <path d="M14 27h10M14 33h16" />
      <circle cx="35" cy="30" r="3.5" />
    </>,
  );
const MainIcon = () =>
  icon(
    <>
      <rect x="4" y="8" width="40" height="27" rx="4" />
      <path d="M17 42h14M24 35v7" />
      <path d="M20 17.5v9l8-4.5z" />
    </>,
  );
const SingersIcon = () =>
  icon(
    <>
      <rect x="4" y="8" width="40" height="27" rx="4" />
      <path d="M17 42h14M24 35v7" />
      <path d="M13 17h22M16 23h16M19 29h10" />
    </>,
  );

interface CardProps {
  href: string;
  icon: ReactNode;
  title: string;
  tagline: string;
  description: string;
  action: string;
  primary?: boolean;
  /** Display pages open in their own window so they can be dragged onto a TV. */
  newWindow?: boolean;
}

function Card({ href, icon, title, tagline, description, action, primary, newWindow }: CardProps) {
  return (
    <li className={`home-card${primary ? " primary" : ""}`}>
      <div className="home-card-icon">{icon}</div>
      <h2>{title}</h2>
      <p className="home-tagline">{tagline}</p>
      <p className="home-desc">{description}</p>
      <a className={`home-btn${primary ? " primary" : ""}`} href={href} {...(newWindow ? { target: "_blank", rel: "noopener" } : {})}>
        {action}
        <span aria-hidden>{newWindow ? " ↗" : " →"}</span>
      </a>
    </li>
  );
}

const STEPS: { title: string; text: string }[] = [
  { title: "Prepare your songs", text: "Open the control panel, then create a presentation or import one from PowerPoint. Pick a background video and style the text." },
  { title: "Set up the screens", text: "Open each display in its own window, drag it onto its TV, and click once to go fullscreen. They then follow the control panel on their own." },
  { title: "Go live", text: "Click “Go live”, then use Next, Previous and Blank, or the arrow keys, Space and B on the keyboard." },
];

/** The landing page at "/": where to go, how to get started, and whether the server is healthy. */
export function Home() {
  const health = useHealth();

  useEffect(() => {
    document.title = "Lyric Presenter";
  }, []);

  return (
    <div className="home">
      <main className="home-inner">
        <header className="home-header">
          <div className="home-brand">
            <div className="home-logo" aria-hidden>
            <svg viewBox="0 0 48 48" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 14h24M12 24h24M12 34h14" />
            </svg>
            </div>
            <div>
              <h1>Lyric Presenter</h1>
              <p className="home-sub">Lyrics over a looping video, for church and events.</p>
            </div>
          </div>
          <StatusPill health={health} />
        </header>

        {health.state === "ok" && !health.persistent && (
          <p className="home-warning" role="alert">
            <strong>Your data is not being saved permanently.</strong> This server has no storage volume attached, so presentations and videos will be
            lost on the next redeploy. See the README for how to add a Railway Volume.
          </p>
        )}
        {health.state === "storage-problem" && (
          <p className="home-warning" role="alert">
            <strong>The server can't write to its storage.</strong> Check that the volume is mounted correctly.
          </p>
        )}

        <ul className="home-cards" aria-label="Open a page">
          <Card
            primary
            href="/control"
            icon={<ControlIcon />}
            title="Control panel"
            tagline="Run the show"
            description="Build presentations, choose backgrounds, style the text, and control what is on screen."
            action="Open control panel"
          />
          <Card
            newWindow
            href="/display/main"
            icon={<MainIcon />}
            title="Main display"
            tagline="Video + lyrics"
            description="The big screen: the looping background video with the lyrics on top."
            action="Open display"
          />
          <Card
            newWindow
            href="/display/singers"
            icon={<SingersIcon />}
            title="Singers display"
            tagline="Lyrics only"
            description="A clean, high-contrast screen for the singers, with no video behind the words."
            action="Open display"
          />
        </ul>

        <section className="home-steps" aria-labelledby="quickstart">
          <h2 id="quickstart">Quick start</h2>
          <ol>
            {STEPS.map((s) => (
              <li key={s.title}>
                <span className="home-step-title">{s.title}</span>
                <span className="home-step-text">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
