import { useCallback, useEffect, useState } from "react";
import { ApiError, api, setUnauthorizedHandler } from "./api";
import type { Presentation, PresentationDetail, SessionInfo, Slide } from "./api";
import { Library } from "./Library";
import { Login } from "./Login";
import { SlideEditor } from "./SlideEditor";

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

/** /control: owns the data for the library + slide editor and talks to the API. */
export function ControlPanel() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(loadSelected);
  const [loadedDetail, setDetail] = useState<PresentationDetail | null>(null);
  // Remember which presentation the focus belongs to, so it never leaks onto another one.
  const [focus, setFocus] = useState<{ presentationId: number; slideId: number } | null>(null);
  const [error, setError] = useState("");

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return; // login screen takes over
    setError(err instanceof Error ? err.message : "Something went wrong");
  }, []);

  // Find out whether a password is needed; any later 401 sends us back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setSession((s) => (s ? { ...s, authenticated: false } : s)));
    api.session().then(setSession).catch(fail);
  }, [fail]);

  const authenticated = session?.authenticated === true;

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

  // Initial load once we are allowed in.
  useEffect(() => {
    if (!authenticated) return;
    api.listPresentations().then(applyList).catch(fail);
  }, [authenticated, applyList, fail]);

  // Load the slides of the selected presentation.
  useEffect(() => {
    saveSelected(selectedId);
    if (!authenticated || selectedId === null) return;
    let cancelled = false; // ignore a slow response if the selection changed meanwhile
    api
      .getPresentation(selectedId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && fail(err));
    return () => {
      cancelled = true;
    };
  }, [authenticated, selectedId, fail]);

  // Only show slides that belong to the current selection (hides stale data while loading).
  const detail = authenticated && loadedDetail?.id === selectedId ? loadedDetail : null;
  const focusSlideId = focus && detail && focus.presentationId === detail.id ? focus.slideId : null;

  const setSlides = (fn: (slides: Slide[]) => Slide[]) =>
    setDetail((d) => (d ? { ...d, slides: fn(d.slides) } : d));
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

  async function signOut() {
    await api.logout().catch(fail);
    setSession((s) => (s ? { ...s, authenticated: false } : s));
    setPresentations([]);
    setDetail(null);
  }

  if (!session) return <main className="loading">{error || "Loading…"}</main>;
  if (!authenticated) {
    return <Login onSuccess={() => setSession({ ...session, authenticated: true })} />;
  }

  return (
    <div className="control">
      <header className="topbar">
        <h1>Lyric Presenter</h1>
        <span className="muted">Control panel</span>
        {session.authRequired && (
          <button type="button" className="signout" onClick={() => void signOut()}>
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

      <div className="layout">
        <Library
          presentations={presentations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={createPresentation}
          onRename={renamePresentation}
          onDuplicate={duplicatePresentation}
          onDelete={deletePresentation}
        />
        {detail ? (
          <SlideEditor
            key={detail.id}
            name={detail.name}
            slides={detail.slides}
            focusSlideId={focusSlideId}
            onAdd={addSlide}
            onSave={saveSlide}
            onDelete={deleteSlide}
            onReorder={reorderSlides}
          />
        ) : (
          <section className="editor empty-state">
            <p className="muted">
              {selectedId !== null ? "Loading…" : presentations.length ? "Select a presentation." : "Create your first presentation to begin."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
