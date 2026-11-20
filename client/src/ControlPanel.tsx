import { useCallback, useEffect, useRef, useState } from "react";
import { mergeSettings } from "../../shared/types";
import type { DisplayState, LiveInfo, Presence } from "../../shared/types";
import { ApiError, api, setUnauthorizedHandler } from "./api";
import type { DeepPartialSettings, Presentation, PresentationDetail, SessionInfo, Slide, Video } from "./api";
import { Library } from "./Library";
import { LivePanel } from "./LivePanel";
import { Login } from "./Login";
import { SlideEditor } from "./SlideEditor";
import { isTypingTarget, shortcutFor } from "./shortcuts";
import { useSocket } from "./socket";
import { StylePanel } from "./StylePanel";
import { VideoManager } from "./VideoManager";

type Tab = "slides" | "style" | "videos";
const TABS: { id: Tab; label: string }[] = [
  { id: "slides", label: "Slides" },
  { id: "style", label: "Style" },
  { id: "videos", label: "Videos" },
];

const FALLBACK_SAMPLE = "Amazing grace, how sweet the sound\nThat saved a wretch like me";

/** Combine two partial settings patches (later values win within each section). */
function mergePatches(a: DeepPartialSettings | undefined, b: DeepPartialSettings): DeepPartialSettings {
  return { main: { ...a?.main, ...b.main }, singers: { ...a?.singers, ...b.singers } };
}

const SELECTED_KEY = "lp.selectedPresentation";

function loadSelected(): number | null {
  try {
    const n = Number(localStorage.getItem(SELECTED_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function saveSelected(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(SELECTED_KEY);
    else localStorage.setItem(SELECTED_KEY, String(id));
  } catch {
    /* storage blocked: the selection just won't be remembered */
  }
}

/** /control: handles the optional password, then shows the workspace. */
export function ControlPanel() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState("");

  // Find out whether a password is needed; any later 401 sends us back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setSession((s) => (s ? { ...s, authenticated: false } : s)));
    api.session().then(setSession).catch((err: unknown) => setError(err instanceof Error ? err.message : "Can't reach the server"));
  }, []);

  if (!session) return <main className="loading">{error || "Loading…"}</main>;
  if (!session.authenticated) return <Login onSuccess={() => setSession({ ...session, authenticated: true })} />;

  async function signOut() {
    await api.logout().catch(() => {});
    setSession((s) => (s ? { ...s, authenticated: false } : s));
  }
  return <Workspace authRequired={session.authRequired} onSignOut={() => void signOut()} />;
}

/** Everything that needs a logged-in operator: live controls, library, slides, videos. */
function Workspace({ authRequired, onSignOut }: { authRequired: boolean; onSignOut: () => void }) {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(loadSelected);
  const [loadedDetail, setDetail] = useState<PresentationDetail | null>(null);
  // Remember which presentation the focus belongs to, so it never leaks onto another one.
  const [focus, setFocus] = useState<{ presentationId: number; slideId: number } | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [maxUploadMb, setMaxUploadMb] = useState(500);
  const [tab, setTab] = useState<Tab>("slides");
  const [error, setError] = useState("");

  // Live state, pushed by the server over the WebSocket.
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [presence, setPresence] = useState<Presence>({ main: 0, singers: 0 });
  const { connected, send } = useSocket("control", (msg) => {
    if (msg.type === "live") {
      setLive(msg.live);
      setPresence(msg.presence);
      setDisplay(msg.display);
    }
  });

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return; // login screen takes over
    setError(err instanceof Error ? err.message : "Something went wrong");
  }, []);

  // --- Keyboard shortcuts for the live controls ----------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "Escape" && isTypingTarget(target)) return void target?.blur(); // back to shortcut mode
      if (document.querySelector("dialog[open]")) return; // a confirmation is open
      if (target?.closest?.("[aria-roledescription='sortable']")) return; // keyboard drag-and-drop uses Space/arrows
      const action = shortcutFor({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, target });
      if (!action) return;
      e.preventDefault();
      send({ type: action });
    };
    // Space on a focused button would otherwise ALSO click that button when released.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && (e.target as HTMLElement | null)?.tagName === "BUTTON") e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [send]);

  // --- Loading data ----------------------------------------------------------------------------
  const applyList = useCallback((list: Presentation[]) => {
    setPresentations(list);
    // Keep the selection valid: fall back to the first presentation if it was removed.
    setSelectedId((cur) => (cur !== null && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null)));
  }, []);

  const refreshList = useCallback(async () => {
    try {
      applyList(await api.listPresentations());
    } catch (err) {
      fail(err);
    }
  }, [applyList, fail]);

  useEffect(() => {
    api.listPresentations().then(applyList).catch(fail);
    api
      .listVideos()
      .then((r) => {
        setVideos(r.videos);
        setMaxUploadMb(r.maxUploadMb);
      })
      .catch(fail);
  }, [applyList, fail]);

  // Load the slides of the selected presentation.
  useEffect(() => {
    saveSelected(selectedId);
    if (selectedId === null) return;
    let cancelled = false; // ignore a slow response if the selection changed meanwhile
    api
      .getPresentation(selectedId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && fail(err));
    return () => {
      cancelled = true;
    };
  }, [selectedId, fail]);

  // Only show slides that belong to the current selection (hides stale data while loading).
  const detail = loadedDetail?.id === selectedId ? loadedDetail : null;
  const focusSlideId = focus && detail && focus.presentationId === detail.id ? focus.slideId : null;
  const isLive = detail !== null && live?.presentationId === detail.id;

  const setSlides = (fn: (slides: Slide[]) => Slide[]) => setDetail((d) => (d ? { ...d, slides: fn(d.slides) } : d));
  const bumpCount = (id: number, delta: number) =>
    setPresentations((list) => list.map((p) => (p.id === id ? { ...p, slideCount: p.slideCount + delta } : p)));

  // --- Library actions ---------------------------------------------------------------------
  async function createPresentation(name: string) {
    try {
      const p = await api.createPresentation(name);
      await refreshList();
      setSelectedId(p.id);
    } catch (err) {
      fail(err);
    }
  }
  async function renamePresentation(id: number, name: string) {
    try {
      await api.renamePresentation(id, name);
      await refreshList();
      setDetail((d) => (d && d.id === id ? { ...d, name } : d));
    } catch (err) {
      fail(err);
    }
  }
  async function duplicatePresentation(id: number) {
    try {
      const copy = await api.duplicatePresentation(id);
      await refreshList();
      setSelectedId(copy.id);
    } catch (err) {
      fail(err);
    }
  }
  async function deletePresentation(id: number) {
    try {
      await api.deletePresentation(id);
      await refreshList();
    } catch (err) {
      fail(err);
    }
  }

  // --- Slide actions ------------------------------------------------------------------------
  async function addSlide() {
    if (!detail) return;
    try {
      const slide = await api.addSlide(detail.id);
      setSlides((s) => [...s, slide]);
      bumpCount(detail.id, 1);
      setFocus({ presentationId: detail.id, slideId: slide.id });
    } catch (err) {
      fail(err);
    }
  }

  // Rethrows so the slide card can show "couldn't save".
  const saveSlide = useCallback(
    async (id: number, patch: { lyrics: string; notes: string }) => {
      try {
        const updated = await api.updateSlide(id, patch);
        setDetail((d) => (d && d.id === updated.presentationId ? { ...d, slides: d.slides.map((s) => (s.id === id ? updated : s)) } : d));
      } catch (err) {
        fail(err);
        throw err;
      }
    },
    [fail],
  );

  async function deleteSlide(id: number) {
    if (!detail) return;
    try {
      await api.deleteSlide(id);
      setSlides((s) => s.filter((x) => x.id !== id).map((x, i) => ({ ...x, position: i })));
      bumpCount(detail.id, -1);
    } catch (err) {
      fail(err);
    }
  }

  async function reorderSlides(slideIds: number[]) {
    if (!detail) return;
    const before = detail.slides;
    // Optimistic: show the new order immediately, roll back if the server refuses.
    setSlides((s) => slideIds.map((id, i) => ({ ...s.find((x) => x.id === id)!, position: i })));
    try {
      await api.reorderSlides(detail.id, slideIds);
    } catch (err) {
      setSlides(() => before);
      fail(err);
    }
  }

  // --- Going live and background video ----------------------------------------------------------
  const showSlide = (slideId: number) => detail && send({ type: "show", presentationId: detail.id, slideId });
  const goLive = () => detail && send({ type: "show", presentationId: detail.id });

  // --- Styling (debounced so dragging a slider doesn't send a request per pixel) -----------------
  const pendingStyle = useRef<{ id: number; patch: DeepPartialSettings } | null>(null);
  const styleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushStyle = useCallback(async () => {
    clearTimeout(styleTimer.current);
    const pending = pendingStyle.current;
    pendingStyle.current = null;
    if (!pending) return;
    try {
      await api.updateSettings(pending.id, pending.patch);
    } catch (err) {
      fail(err);
      // Our optimistic copy may now differ from the server: reload the truth.
      api
        .getPresentation(pending.id)
        .then((d) => setDetail((cur) => (cur && cur.id === d.id ? d : cur)))
        .catch(() => {});
    }
  }, [fail]);

  // Send anything still waiting when the selection changes or the panel closes.
  useEffect(() => () => void flushStyle(), [selectedId, flushStyle]);

  function changeStyle(patch: DeepPartialSettings) {
    if (!detail) return;
    const id = detail.id;
    if (pendingStyle.current && pendingStyle.current.id !== id) void flushStyle();
    pendingStyle.current = { id, patch: mergePatches(pendingStyle.current?.patch, patch) };
    // Show the change immediately; the server uses the same rules (clamping etc.), so they agree.
    setDetail((d) => (d && d.id === id ? { ...d, settings: mergeSettings(d.settings, patch) } : d));
    clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(() => void flushStyle(), 200);
  }

  // --- Video library ---------------------------------------------------------------------------
  const reloadVideos = useCallback(() => {
    api
      .listVideos()
      .then((r) => {
        setVideos(r.videos);
        setMaxUploadMb(r.maxUploadMb);
      })
      .catch(fail);
  }, [fail]);

  // Re-read the list when opening Style or Videos, so uploads from another window show up.
  useEffect(() => {
    if (tab !== "slides") reloadVideos();
  }, [tab, reloadVideos]);

  async function uploadVideo(file: File, onProgress: (fraction: number) => void, signal: AbortSignal) {
    const video = await api.uploadVideo(file, onProgress, signal); // errors go to the manager, which shows them
    setVideos((vs) => [...vs, { ...video, usedBy: 0 }].sort((x, y) => x.name.localeCompare(y.name)));
  }
  async function renameVideo(id: number, name: string) {
    try {
      const v = await api.renameVideo(id, name);
      setVideos((vs) => vs.map((x) => (x.id === id ? { ...x, name: v.name } : x)).sort((x, y) => x.name.localeCompare(y.name)));
    } catch (err) {
      fail(err);
    }
  }
  async function deleteVideo(id: number) {
    try {
      await api.deleteVideo(id);
      // The server cleared this video from every presentation that used it; mirror that here.
      setDetail((d) =>
        d && d.settings.main.videoId === id ? { ...d, settings: { ...d.settings, main: { ...d.settings.main, videoId: null } } } : d,
      );
      reloadVideos();
    } catch (err) {
      fail(err);
    }
  }

  // Preview text: what is on screen if this presentation is live, else its first non-empty slide.
  const sampleText = (isLive ? display?.lyrics : detail?.slides.find((sl) => sl.lyrics.trim())?.lyrics) || FALLBACK_SAMPLE;

  return (
    <div className="control">
      <header className="topbar">
        <h1>Lyric Presenter</h1>
        <span className="muted">Control panel</span>
        {authRequired && (
          <button type="button" className="signout" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </header>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      <LivePanel live={live} display={display} presence={presence} connected={connected} send={send} />

      <div className="layout">
        <Library
          presentations={presentations}
          selectedId={selectedId}
          livePresentationId={live?.presentationId ?? null}
          onSelect={setSelectedId}
          onCreate={createPresentation}
          onImported={async (p) => {
            await refreshList();
            setSelectedId(p.id);
            setTab("slides");
          }}
          onRename={renamePresentation}
          onDuplicate={duplicatePresentation}
          onDelete={deletePresentation}
        />
        <div className="workarea">
          <div className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="tab-panel"
                className={tab === t.id ? "active" : ""}
                disabled={t.id !== "videos" && !detail}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "videos" ? (
              <VideoManager
                videos={videos}
                maxUploadMb={maxUploadMb}
                liveVideoUrl={display?.videoUrl ?? null}
                onUpload={uploadVideo}
                onRename={renameVideo}
                onDelete={deleteVideo}
              />
            ) : !detail ? (
              <section className="editor empty-state">
                <p className="muted">
                  {selectedId !== null ? "Loading…" : presentations.length ? "Select a presentation." : "Create your first presentation to begin."}
                </p>
              </section>
            ) : tab === "style" ? (
              <StylePanel
                settings={detail.settings}
                videos={videos}
                sampleText={sampleText}
                onChange={changeStyle}
                onManageVideos={() => setTab("videos")}
              />
            ) : (
              <SlideEditor
                key={detail.id}
                name={detail.name}
                slides={detail.slides}
                focusSlideId={focusSlideId}
                isLive={isLive}
                liveSlideId={isLive ? (live?.slideId ?? null) : null}
                onGoLive={goLive}
                onShow={showSlide}
                onAdd={addSlide}
                onSave={saveSlide}
                onDelete={deleteSlide}
                onReorder={reorderSlides}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
