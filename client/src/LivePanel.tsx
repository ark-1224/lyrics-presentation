import { useEffect, useRef } from "react";
import type { ClientCommand, DisplayState, LiveInfo, Presence } from "../../shared/types";
import { DisplayView } from "./DisplayView";
import { sectionButtons, sectionClass, sectionLabel } from "./sections";
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

/**
 * Every slide of the live presentation as a list. Click any one to put it on the screens
 * right away, in any order (slide 1 to slide 5, back to slide 2...).
 */
function JumpList({ live, enabled, send }: { live: LiveInfo; enabled: boolean; send: (cmd: ClientCommand) => void }) {
  const box = useRef<HTMLOListElement>(null);

  // Keep the current slide in view inside the list (without scrolling the whole page).
  useEffect(() => {
    const list = box.current;
    const active = list?.querySelector<HTMLElement>("[aria-current='true']");
    if (list && active) list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
  }, [live.slideId]);

  return (
    <div className="jump">
      <h3>Jump to slide</h3>
      <ol ref={box} className="jump-list">
        {live.slides.map((s, i) => {
          const current = s.id === live.slideId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={current ? "current" : ""}
                aria-current={current}
                disabled={!enabled}
                onClick={() => send({ type: "goto", slideId: s.id })}
              >
                <span className="num">{i + 1}</span>
                {s.section && <span className={`sec-chip ${sectionClass(s.section)}`}>{sectionLabel(s.section)}</span>}
                <span className="txt">{s.text || "(empty slide)"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One button per song section (Verse, Chorus, Bridge...) used in the live presentation.
 * Pressing one jumps to the next slide with that label after the current slide, then wraps around,
 * so repeated presses walk through a repeating chorus. The button for the section on screen is marked.
 */
function SectionButtons({ live, enabled, send }: { live: LiveInfo; enabled: boolean; send: (cmd: ClientCommand) => void }) {
  const buttons = sectionButtons(live.slides);
  const current = live.slides.find((s) => s.id === live.slideId)?.section ?? "";
  return (
    <div className="section-jump" role="group" aria-label="Jump to section">
      <span className="section-jump-label">Jump to</span>
      {buttons.length === 0 ? (
        <span className="muted section-hint">Label slides as Verse, Chorus, Bridge… in the Slides tab to get jump buttons here.</span>
      ) : (
        buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={sectionClass(b.key)}
            aria-current={current === b.key ? "true" : undefined}
            aria-disabled={!enabled}
            title={b.count > 1 ? `Next ${b.label} (${b.count} in this song)` : `Go to the ${b.label}`}
            onClick={() => enabled && send({ type: "section", section: b.key })}
          >
            {b.label}
            {b.count > 1 && <span className="count"> ×{b.count}</span>}
          </button>
        ))
      )}
    </div>
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
          {live?.presentationId != null && live.slides.length > 0 && <SectionButtons live={live} enabled={isLive} send={send} />}
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

        <div className="live-side">
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
        {live?.presentationId != null && live.slides.length > 0 && <JumpList live={live} enabled={isLive} send={send} />}
        </div>
      </div>
    </section>
  );
}
