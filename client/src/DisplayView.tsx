import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { FONTS } from "../../shared/types";
import type { DisplayState, DisplayStyle } from "../../shared/types";

// Everything here is deliberately cheap to draw: only opacity transitions, one video element
// (briefly two while crossfading), no filters or blur. That keeps CPU low when the window is
// mirrored to a TV over AirPlay.

const TEXT_FADE_MS = 350;
const VIDEO_FADE_MS = 800;

/** Where the screen's edges end and the text area starts, in % of screen height/width. */
const MARGIN_V = 4;
const MARGIN_H = 4;

/**
 * Text style for one display. All sizes use container-query units (cqh/cqw) so the same code
 * renders correctly full screen at 1080p or 4K and inside the small previews in the control panel.
 */
export function textStyle(s: DisplayStyle): CSSProperties {
  const o = s.shadow * 0.05; // outline thickness, in % of screen height
  const shadow =
    s.shadow > 0
      ? [
          `${o}cqh 0 0 #000`, `-${o}cqh 0 0 #000`, `0 ${o}cqh 0 #000`, `0 -${o}cqh 0 #000`,
          `${o}cqh ${o}cqh 0 #000`, `-${o}cqh ${o}cqh 0 #000`, `${o}cqh -${o}cqh 0 #000`, `-${o}cqh -${o}cqh 0 #000`,
          `0 0 ${s.shadow * 0.3}cqh rgba(0,0,0,0.9)`,
        ].join(", ")
      : "none";
  return {
    left: `${MARGIN_H}cqw`,
    right: `${MARGIN_H}cqw`,
    // 0 = text block touches the top margin, 100 = touches the bottom margin, 50 = centred.
    top: `${MARGIN_V + ((100 - 2 * MARGIN_V) * s.vertical) / 100}cqh`,
    transform: `translateY(-${s.vertical}%)`,
    textAlign: s.align,
    fontFamily: FONTS[s.font].css,
    fontSize: `${s.fontSize}cqh`,
    fontWeight: s.bold ? 700 : 400,
    color: s.color,
    textShadow: shadow,
  };
}

interface TextLayer {
  id: number;
  text: string;
  leaving: boolean;
}

/** Crossfade between slides: the new text fades in while the old text fades out. */
function FadingText({ text, style }: { text: string; style: DisplayStyle }) {
  const [layers, setLayers] = useState<TextLayer[]>([{ id: 0, text, leaving: false }]);

  // When the text prop changes, add a new layer and mark the others as leaving.
  // (Updating state while rendering, guarded by a condition, is React's recommended pattern for this.)
  const current = [...layers].reverse().find((l) => !l.leaving);
  if (current?.text !== text) {
    setLayers((ls) => [...ls.map((l) => ({ ...l, leaving: true })), { id: (ls[ls.length - 1]?.id ?? 0) + 1, text, leaving: false }]);
  }

  // Drop old layers once their fade-out is over.
  useEffect(() => {
    if (!layers.some((l) => l.leaving)) return;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), TEXT_FADE_MS + 50);
    return () => clearTimeout(t);
  }, [layers]);

  const css = textStyle(style);
  return (
    <>
      {layers.map((l) => (
        <div key={l.id} className={`dv-text${l.leaving ? " leaving" : ""}`} style={css}>
          {l.text}
        </div>
      ))}
    </>
  );
}

interface VideoLayer {
  id: number;
  url: string;
  ready: boolean;
  leaving: boolean;
}

/**
 * Looping, muted, full-bleed background video. Switching videos loads the new one hidden,
 * fades it in once it can play, then fades the old one out and removes it.
 */
function VideoBackground({ url }: { url: string | null }) {
  const [layers, setLayers] = useState<VideoLayer[]>(url ? [{ id: 0, url, ready: false, leaving: false }] : []);

  const current = [...layers].reverse().find((l) => !l.leaving);
  if ((current?.url ?? null) !== url) {
    setLayers((ls) =>
      url
        ? [...ls, { id: (ls[ls.length - 1]?.id ?? -1) + 1, url, ready: false, leaving: false }]
        : ls.map((l) => ({ ...l, leaving: true })),
    );
  }

  useEffect(() => {
    if (!layers.some((l) => l.leaving)) return;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), VIDEO_FADE_MS + 100);
    return () => clearTimeout(t);
  }, [layers]);

  return (
    <>
      {layers.map((l) => (
        <video
          key={l.id}
          className="dv-video"
          src={l.url}
          style={{ opacity: l.ready && !l.leaving ? 1 : 0 }}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          // Once the new video can play, everything older starts fading out.
          onCanPlay={() => setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, ready: true } : x.id < l.id ? { ...x, leaving: true } : x)))}
          // A video that fails to load is simply dropped; the previous one (or black) stays.
          onError={() => setLayers((ls) => ls.filter((x) => x.id !== l.id))}
        />
      ))}
    </>
  );
}

interface Props {
  kind: "main" | "singers";
  state: DisplayState;
  /** Small control-panel preview: no video (saves CPU) and a hint background instead. */
  preview?: boolean;
}

/** One display's picture. Used full screen on the display pages and scaled down in the control panel. */
export function DisplayView({ kind, state, preview = false }: Props) {
  const style = kind === "main" ? state.settings.main : state.settings.singers;
  const background = kind === "singers" ? state.settings.singers.backgroundColor : "#000";
  return (
    <div className={`dv${preview && kind === "main" ? " dv-preview-main" : ""}`} style={{ background }}>
      {kind === "main" && !preview && <VideoBackground url={state.videoUrl} />}
      <div className="dv-text-wrap" style={{ opacity: state.blank ? 0 : 1 }}>
        <FadingText text={state.lyrics} style={style} />
      </div>
    </div>
  );
}
