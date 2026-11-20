// Types and helpers shared by the server and the browser (no runtime dependencies).

// ---- Styling settings (stored per presentation) ---------------------------------------------

/** Web-safe font stacks. The key is stored in settings; the css is what gets rendered. */
export const FONTS = {
  sans: { label: "Sans-serif", css: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  arial: { label: "Arial", css: "Arial, Helvetica, sans-serif" },
  verdana: { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  trebuchet: { label: "Trebuchet", css: '"Trebuchet MS", Helvetica, sans-serif' },
  georgia: { label: "Georgia (serif)", css: 'Georgia, "Times New Roman", serif' },
  impact: { label: "Impact (bold)", css: 'Impact, "Arial Narrow Bold", sans-serif' },
  mono: { label: "Monospace", css: '"Courier New", Courier, monospace' },
} as const;
export type FontKey = keyof typeof FONTS;

export type Align = "left" | "center" | "right";

export interface DisplayStyle {
  font: FontKey;
  /** Text size as a percentage of the screen HEIGHT, so it scales the same at 1080p and 4K. */
  fontSize: number;
  color: string; // #rrggbb
  align: Align;
  /** Where the text block sits: 0 = top edge, 50 = centred, 100 = bottom edge. */
  vertical: number;
  /** Outline/shadow strength for readability over bright video: 0 (none) to 10. */
  shadow: number;
  bold: boolean;
}

export interface MainStyle extends DisplayStyle {
  videoId: number | null;
}
export interface SingersStyle extends DisplayStyle {
  backgroundColor: string; // #rrggbb
}

export interface PresentationSettings {
  main: MainStyle;
  singers: SingersStyle;
}

export const DEFAULT_SETTINGS: PresentationSettings = {
  main: {
    font: "sans",
    fontSize: 7,
    color: "#ffffff",
    align: "center",
    vertical: 50,
    shadow: 6,
    bold: true,
    videoId: null,
  },
  singers: {
    font: "sans",
    fontSize: 9,
    color: "#ffffff",
    align: "center",
    vertical: 50,
    shadow: 0,
    bold: true,
    backgroundColor: "#000000",
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALIGNS: Align[] = ["left", "center", "right"];

function num(raw: unknown, min: number, max: number, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}
function hex(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX.test(raw) ? raw.toLowerCase() : fallback;
}
function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function normalizeStyle(raw: unknown, d: DisplayStyle): DisplayStyle {
  const r = isObject(raw) ? raw : {};
  return {
    font: typeof r.font === "string" && r.font in FONTS ? (r.font as FontKey) : d.font,
    fontSize: num(r.fontSize, 1, 25, d.fontSize),
    color: hex(r.color, d.color),
    align: ALIGNS.includes(r.align as Align) ? (r.align as Align) : d.align,
    vertical: num(r.vertical, 0, 100, d.vertical),
    shadow: num(r.shadow, 0, 10, d.shadow),
    bold: typeof r.bold === "boolean" ? r.bold : d.bold,
  };
}

/**
 * Turn anything (stored JSON, a client patch) into a complete, valid settings object:
 * unknown or invalid fields fall back to defaults, numbers are clamped.
 */
export function normalizeSettings(raw: unknown): PresentationSettings {
  const r = isObject(raw) ? raw : {};
  const main: Record<string, unknown> = isObject(r.main) ? r.main : {};
  const singers: Record<string, unknown> = isObject(r.singers) ? r.singers : {};
  const videoId = main.videoId;
  return {
    main: {
      ...normalizeStyle(main, DEFAULT_SETTINGS.main),
      videoId: typeof videoId === "number" && Number.isInteger(videoId) && videoId > 0 ? videoId : null,
    },
    singers: {
      ...normalizeStyle(singers, DEFAULT_SETTINGS.singers),
      backgroundColor: hex(singers.backgroundColor, DEFAULT_SETTINGS.singers.backgroundColor),
    },
  };
}

/** Apply a partial update (e.g. only `{main: {fontSize: 9}}`) on top of current settings. */
export function mergeSettings(current: PresentationSettings, patch: unknown): PresentationSettings {
  const p = isObject(patch) ? patch : {};
  return normalizeSettings({
    main: { ...current.main, ...(isObject(p.main) ? p.main : {}) },
    singers: { ...current.singers, ...(isObject(p.singers) ? p.singers : {}) },
  });
}

// ---- Live state -----------------------------------------------------------------------------

/** Everything a display window needs to draw itself. Never contains private notes. */
export interface DisplayState {
  version: number;
  blank: boolean;
  lyrics: string;
  settings: PresentationSettings;
  /** URL of the background video for the Main display, or null. */
  videoUrl: string | null;
}

/** What the control panel additionally needs to know about the live presentation. */
export interface LiveInfo {
  presentationId: number | null;
  presentationName: string | null;
  slideId: number | null;
  slideIndex: number;
  slideCount: number;
  blank: boolean;
  nextLyrics: string | null;
  notes: string;
}

/** How many windows of each kind are currently connected. */
export interface Presence {
  main: number;
  singers: number;
}

export type Role = "control" | "main" | "singers";

// ---- WebSocket protocol ---------------------------------------------------------------------

/** Control panel -> server. Only sockets that connected as "control" may send these. */
export type ClientCommand =
  | { type: "show"; presentationId: number; slideId?: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "blank"; value?: boolean } // value omitted = toggle
  | { type: "goto"; slideId: number };

/** Server -> clients. */
export type ServerMessage =
  | { type: "display"; state: DisplayState }
  | { type: "live"; live: LiveInfo; presence: Presence; display: DisplayState }
  | { type: "hb" }; // heartbeat so clients can detect a dead connection

// ---- REST payloads --------------------------------------------------------------------------

export interface Video {
  id: number;
  name: string;
  size: number;
  mime: string;
  url: string;
  createdAt: string;
}
