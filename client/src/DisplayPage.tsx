import { useEffect, useState } from "react";
import type { DisplayState } from "../../shared/types";
import { DisplayView } from "./DisplayView";
import { useSocket } from "./socket";

const TITLES = { main: "Main display", singers: "Singers display" } as const;

/** Ask the browser to keep the screen on while the display is running (best effort). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    const request = () => navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    void request();
    // The browser releases the lock when the tab is hidden, so ask again when it comes back.
    const onVisible = () => document.visibilityState === "visible" && void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * /display/main and /display/singers. After one click (needed by browsers for fullscreen)
 * the page is fully controlled from the control panel. It keeps showing the last slide if
 * the connection drops and catches up by itself when it comes back.
 */
export function DisplayPage({ kind }: { kind: "main" | "singers" }) {
  const [state, setState] = useState<DisplayState | null>(null);
  const [started, setStarted] = useState(false);
  const [offline, setOffline] = useState(false);

  const { connected } = useSocket(kind, (msg) => {
    if (msg.type === "display") setState(msg.state);
  });
  useWakeLock(started);

  useEffect(() => {
    document.body.classList.add("display-body");
    document.title = `${TITLES[kind]} – Lyric Presenter`;
    return () => document.body.classList.remove("display-body");
  }, [kind]);

  // Only show the "reconnecting" dot after 3 s, so a quick blip never flashes on the TV.
  useEffect(() => {
    const t = setTimeout(() => setOffline(!connected), connected ? 0 : 3000);
    return () => clearTimeout(t);
  }, [connected]);

  function start() {
    setStarted(true);
    // Fullscreen needs a user gesture; if it is refused the display still works in a normal window.
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className={`display-stage${started ? " started" : ""}`}>
      {state && <DisplayView kind={kind} state={state} />}
      {offline && <div className="offline-dot" title="Reconnecting…" role="status" aria-label="Reconnecting" />}
      {!started && (
        <button type="button" className="display-start" onClick={start}>
          <strong>Click to start</strong>
          <span>{TITLES[kind]} – goes fullscreen, then is controlled from the control panel</span>
        </button>
      )}
    </div>
  );
}
