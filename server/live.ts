import { DEFAULT_SETTINGS } from "../shared/types.js";
import type { ClientCommand, DisplayState, LiveInfo } from "../shared/types.js";
import type { Repo } from "./repo.js";

/** The only state that is "owned" by the live service; everything else is derived from the DB. */
interface Persisted {
  presentationId: number | null;
  slideId: number | null;
  slideIndex: number; // last known position, used to pick a neighbour if the slide gets deleted
  blank: boolean;
}

const KV_KEY = "live";

/**
 * Server-side source of truth for "what is on the screens right now".
 *
 * - Control panels send commands (show/next/prev/goto/blank).
 * - Anything that edits data (slides, settings, videos) calls refresh() so displays update
 *   even when the live slide is edited or reordered.
 * - Listeners (the WebSocket layer) are told only when something actually changed.
 * - The state is saved to the DB so a server restart resumes on the same slide.
 */
export function createLive(repo: Repo) {
  let state: Persisted = load();
  let version = 0;
  let display: DisplayState;
  let info: LiveInfo;
  let displayJson = "";
  let infoJson = "";
  const displayListeners = new Set<(d: DisplayState) => void>();
  const infoListeners = new Set<() => void>();

  function load(): Persisted {
    const empty: Persisted = { presentationId: null, slideId: null, slideIndex: 0, blank: false };
    try {
      const raw = repo.getKv(KV_KEY);
      return raw ? { ...empty, ...(JSON.parse(raw) as Partial<Persisted>) } : empty;
    } catch {
      return empty;
    }
  }

  /** Re-read the DB, fix up `state` if what it points at changed, and push updates if needed. */
  function refresh() {
    const presentation = state.presentationId !== null ? repo.getPresentation(state.presentationId) : undefined;
    const slides = presentation ? repo.listSlides(presentation.id) : [];
    if (!presentation) state = { ...state, presentationId: null };

    // Keep showing the same slide even if it was moved; if it was deleted, stay at the same position.
    let index = slides.findIndex((s) => s.id === state.slideId);
    if (index < 0) index = slides.length ? Math.min(state.slideIndex, slides.length - 1) : -1;
    const slide = slides[index];
    state = { ...state, slideId: slide?.id ?? null, slideIndex: Math.max(index, 0) };

    const settings = presentation ? repo.getSettings(presentation.id)! : DEFAULT_SETTINGS;
    const video = settings.main.videoId !== null ? repo.getVideo(settings.main.videoId) : undefined;

    const nextDisplay = {
      blank: state.blank,
      lyrics: slide?.lyrics ?? "",
      settings,
      videoUrl: video?.url ?? null,
    };
    const nextInfo: LiveInfo = {
      presentationId: presentation?.id ?? null,
      presentationName: presentation?.name ?? null,
      slideId: slide?.id ?? null,
      slideIndex: state.slideIndex,
      slideCount: slides.length,
      blank: state.blank,
      nextLyrics: slides[index + 1]?.lyrics ?? null,
      notes: slide?.notes ?? "",
    };

    const nextDisplayJson = JSON.stringify(nextDisplay);
    const nextInfoJson = JSON.stringify(nextInfo);
    const displayChanged = nextDisplayJson !== displayJson;
    const infoChanged = nextInfoJson !== infoJson;
    if (!displayChanged && !infoChanged) return;

    if (displayChanged) {
      displayJson = nextDisplayJson;
      version += 1;
      display = { version, ...nextDisplay };
    }
    if (infoChanged) {
      infoJson = nextInfoJson;
      info = nextInfo;
      repo.setKv(KV_KEY, JSON.stringify(state));
    }
    // Displays only care about their own state; controls get everything.
    if (displayChanged) for (const fn of displayListeners) fn(display);
    for (const fn of infoListeners) fn();
  }

  /** Move to another slide of the live presentation by offset (-1 / +1), staying within the song. */
  function step(delta: number) {
    if (state.presentationId === null) return;
    const slides = repo.listSlides(state.presentationId);
    const current = slides.findIndex((s) => s.id === state.slideId);
    const target = slides[Math.min(slides.length - 1, Math.max(0, (current < 0 ? 0 : current + delta)))];
    if (target) state = { ...state, slideId: target.id };
  }

  function command(cmd: ClientCommand) {
    switch (cmd.type) {
      case "show": {
        if (!repo.getPresentation(cmd.presentationId)) return;
        const slides = repo.listSlides(cmd.presentationId);
        const target = slides.find((s) => s.id === cmd.slideId) ?? slides[0];
        // `blank` is kept: if the operator blanked the screens, going live doesn't surprise them.
        state = { ...state, presentationId: cmd.presentationId, slideId: target?.id ?? null, slideIndex: 0 };
        break;
      }
      case "next":
        step(+1);
        break;
      case "prev":
        step(-1);
        break;
      case "goto": {
        if (state.presentationId === null) return;
        const slide = repo.getSlide(cmd.slideId);
        if (slide?.presentationId !== state.presentationId) return;
        state = { ...state, slideId: slide.id };
        break;
      }
      case "blank":
        state = { ...state, blank: cmd.value ?? !state.blank };
        break;
    }
    refresh();
  }

  refresh(); // compute the initial state (no listeners yet)

  return {
    command,
    refresh,
    getDisplay: () => display,
    getInfo: () => info,
    onDisplay(fn: (d: DisplayState) => void) {
      displayListeners.add(fn);
      return () => displayListeners.delete(fn);
    },
    onInfo(fn: () => void) {
      infoListeners.add(fn);
      return () => infoListeners.delete(fn);
    },
  };
}

export type Live = ReturnType<typeof createLive>;
