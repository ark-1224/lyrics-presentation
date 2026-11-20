import type { ClientCommand, DisplayState, LiveInfo, Presence } from "../../shared/types";
import { DisplayView } from "./DisplayView";
import { SHORTCUT_HELP } from "./shortcuts";

interface Props {
  live: LiveInfo | null;
  display: DisplayState | null;
  presence: Presence;
  /** Is the control panel's own connection to the server up? */
  connected: boolean;
  send: (cmd: ClientCommand) => void;
}

/** on = connected; off = not connected; unknown = we can't tell because our own connection is down. */
function StatusChip({ label, state }: { label: string; state: "on" | "off" | "unknown" }) {
  const text = state === "on" ? "connected" : state === "off" ? "not connected" : "unknown";
  return (
    <span className={`chip ${state}`}>
      <span className="dot" aria-hidden />
      {label}: {text}
    </span>
  );
}

/** Live controls: next/prev/blank, what is on screen now, what comes next, previews, and the connection lights. */
export function LivePanel({ live, display, presence, connected, send }: Props) {
  // While our own connection is down the commands would be dropped, so the buttons are disabled
  // and the display lights are shown as "unknown" instead of a stale "connected".
  const isLive = live?.presentationId != null && connected;
  const blank = live?.blank ?? false;
  const atStart = !live || live.slideIndex <= 0;
  const atEnd = !live || live.slideIndex >= live.slideCount - 1;

  return (
    <section className="live" aria-label="Live controls">
      <div className="live-head">
        <h2>Live</h2>
        {live?.presentationId != null ? (
          <span className="live-title">
            {live.presentationName}
            {live.slideCount > 0 && (
              <span className="muted">
                {" "}
                · slide {live.slideIndex + 1} of {live.slideCount}
              </span>
            )}
          </span>
        ) : (
          <span className="muted">Nothing is live. Pick a presentation and click “Go live”.</span>
        )}
        <div className="chips">
          <StatusChip label="Main" state={!connected ? "unknown" : presence.main > 0 ? "on" : "off"} />
          <StatusChip label="Singers" state={!connected ? "unknown" : presence.singers > 0 ? "on" : "off"} />
          {!connected && <span className="chip warn">Control panel offline – reconnecting…</span>}
        </div>
      </div>

      <div className="live-body">
        <div className="live-controls">
          <div className="buttons">
            <button type="button" className="big" disabled={!isLive || atStart} onClick={() => send({ type: "prev" })}>
              ← Previous
            </button>
            <button type="button" className="big primary" disabled={!isLive || atEnd} onClick={() => send({ type: "next" })}>
              Next →
            </button>
            <button type="button" className={`big${blank ? " blank-on" : ""}`} disabled={!isLive} onClick={() => send({ type: "blank" })} aria-pressed={blank}>
              {blank ? "Show text (B)" : "Blank text (B)"}
            </button>
          </div>
          {blank && live?.presentationId != null && <p className="blank-note">Text is hidden on both displays. The video keeps playing.</p>}

          <div className="slide-peek now">
            <h3>Now showing</h3>
            <pre>{live?.presentationId != null ? display?.lyrics || "(empty slide)" : "—"}</pre>
          </div>
          <div className="slide-peek next">
            <h3>Next</h3>
            <pre>{live?.presentationId != null ? (live.nextLyrics ?? "(end of presentation)") : "—"}</pre>
          </div>
          {live?.presentationId != null && live.notes && (
            <div className="slide-peek notes">
              <h3>Notes for this slide (private)</h3>
              <pre>{live.notes}</pre>
            </div>
          )}

          <dl className="shortcuts" aria-label="Keyboard shortcuts">
            {SHORTCUT_HELP.map((s) => (
              <div key={s.keys}>
                <dt>{s.keys}</dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="previews">
          <figure>
            <div className="preview-box">{display ? <DisplayView kind="main" state={display} preview /> : null}</div>
            <figcaption>Main display{display?.videoUrl ? " (video not shown in preview)" : ""}</figcaption>
          </figure>
          <figure>
            <div className="preview-box">{display ? <DisplayView kind="singers" state={display} preview /> : null}</div>
            <figcaption>Singers display</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
