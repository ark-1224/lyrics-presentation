import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CustomSection, SectionId, SlideSection } from "../../shared/types";
import type { Slide } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { SectionPicker } from "./SectionPicker";
import { sectionClass } from "./sections";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface CardProps {
  slide: Slide;
  index: number;
  autoFocus: boolean;
  /** True when this slide is the one on the displays right now. */
  isLive: boolean;
  onShow: (slideId: number) => void;
  onSetSection: (slideId: number, section: SlideSection) => void;
  /** How many slides in this song share this slide's section (renaming changes them all). */
  sectionCount: number;
  onRenameSection: (from: CustomSection, to: SectionId) => void;
  onSave: (id: number, patch: { lyrics: string; notes: string }) => Promise<void>;
  onDelete: (slide: Slide) => void;
}

/**
 * One editable slide. Text is kept in local state so typing never waits on the server;
 * it is saved 0.8 s after the last keystroke, on blur, and when the card goes away.
 */
function SlideCard({ slide, index, autoFocus, isLive, onShow, onSetSection, sectionCount, onRenameSection, onSave, onDelete }: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const [lyrics, setLyrics] = useState(slide.lyrics);
  const [notes, setNotes] = useState(slide.notes);
  const [showNotes, setShowNotes] = useState(slide.notes.length > 0);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const saved = useRef({ lyrics: slide.lyrics, notes: slide.notes });
  // Refs mirror the newest text/flush so blur and unmount handlers never see stale values.
  const latest = useRef({ lyrics, notes });
  useEffect(() => {
    latest.current = { lyrics, notes };
  });

  const flush = useCallback(async () => {
    const { lyrics: l, notes: n } = latest.current;
    if (l === saved.current.lyrics && n === saved.current.notes) return;
    setStatus("saving");
    try {
      await onSave(slide.id, { lyrics: l, notes: n });
      saved.current = { lyrics: l, notes: n };
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [onSave, slide.id]);

  // Debounced autosave.
  useEffect(() => {
    const t = setTimeout(() => void flush(), 800);
    return () => clearTimeout(t);
  }, [lyrics, notes, flush]);

  // Don't lose pending edits when the card unmounts (e.g. switching presentation).
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => void flushRef.current(), []);

  const lineCount = lyrics.split("\n").length;

  return (
    <li
      ref={setNodeRef}
      className={`slide-card${isDragging ? " dragging" : ""}${isLive ? " is-live" : ""}${slide.section ? ` has-section ${sectionClass(slide.section)}` : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="slide-head">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="handle"
          aria-label={`Drag to reorder slide ${index + 1}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <span className="slide-number">Slide {index + 1}</span>
        {isLive && <span className="live-badge">ON SCREEN</span>}
        <SectionPicker
          section={slide.section}
          slideNumber={index + 1}
          sharedBy={sectionCount}
          onSet={(section) => onSetSection(slide.id, section)}
          onRename={onRenameSection}
        />
        <button type="button" className="show-btn" onClick={() => onShow(slide.id)} disabled={isLive} title="Put this slide on the displays">
          ▶ Show
        </button>
        <span className={`save-status ${status}`} aria-live="polite">
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && "Couldn't save – retry by editing"}
        </span>
        <button type="button" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
          {showNotes ? "Hide notes" : notes ? "Show notes" : "Add notes"}
        </button>
        <button
          type="button"
          className="danger-text"
          // Pass the current (possibly unsaved) text so the parent can skip confirming empty slides.
          onClick={() => onDelete({ ...slide, lyrics, notes })}
        >
          Delete
        </button>
      </div>
      <textarea
        className="lyrics"
        value={lyrics}
        rows={Math.max(3, Math.min(lineCount + 1, 14))}
        placeholder="Lyrics for this slide (one slide = one screen of text)"
        aria-label={`Lyrics for slide ${index + 1}`}
        autoFocus={autoFocus}
        onChange={(e) => setLyrics(e.target.value)}
        onBlur={() => void flush()}
      />
      {showNotes && (
        <textarea
          className="notes"
          value={notes}
          rows={2}
          placeholder="Private notes (only shown here on the control panel, never on the displays)"
          aria-label={`Private notes for slide ${index + 1}`}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void flush()}
        />
      )}
    </li>
  );
}

interface Props {
  name: string;
  slides: Slide[];
  focusSlideId: number | null;
  /** Is this presentation the one on the displays, and which of its slides is showing? */
  isLive: boolean;
  liveSlideId: number | null;
  onGoLive: () => void;
  onShow: (slideId: number) => void;
  onSetSection: (slideId: number, section: SlideSection) => void;
  onRenameSection: (from: CustomSection, to: SectionId) => void;
  /** Settings controls (background video picker) rendered under the heading. */
  children?: ReactNode;
  onAdd: () => Promise<void>;
  onSave: (id: number, patch: { lyrics: string; notes: string }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReorder: (slideIds: number[]) => Promise<void>;
}

/** Right column: the selected presentation's slides, with add / edit / drag-reorder / delete. */
export function SlideEditor({ name, slides, focusSlideId, isLive, liveSlideId, onGoLive, onShow, onSetSection, onRenameSection, children, onAdd, onSave, onDelete, onReorder }: Props) {
  const [deleting, setDeleting] = useState<Slide | null>(null);
  const sensors = useSensors(
    // A small drag distance stops a normal click on the handle from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = slides.map((s) => s.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    void onReorder(arrayMove(ids, from, to));
  }

  function requestDelete(slide: Slide) {
    if (!slide.lyrics.trim() && !slide.notes.trim()) void onDelete(slide.id);
    else setDeleting(slide);
  }

  return (
    <section className="editor" aria-label={`Slides in ${name}`}>
      <div className="editor-head">
        <h2>{name}</h2>
        <span className="muted">
          {slides.length} slide{slides.length === 1 ? "" : "s"}
        </span>
        {isLive ? (
          <span className="live-badge">LIVE</span>
        ) : (
          <button type="button" className="go-live" onClick={onGoLive} title="Show this presentation on the displays">
            ● Go live
          </button>
        )}
        <button type="button" className="primary add-top" onClick={() => void onAdd()}>
          + Add slide
        </button>
      </div>
      {children}

      {slides.length === 0 && <p className="muted empty">No slides yet. Click “Add slide” to start typing lyrics.</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="slides">
            {slides.map((slide, i) => (
              <SlideCard
                key={slide.id}
                slide={slide}
                index={i}
                autoFocus={slide.id === focusSlideId}
                isLive={isLive && slide.id === liveSlideId}
                onShow={onShow}
                onSetSection={onSetSection}
                sectionCount={slides.filter((s) => s.section === slide.section).length}
                onRenameSection={onRenameSection}
                onSave={onSave}
                onDelete={requestDelete}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {slides.length > 0 && (
        <button type="button" className="add-bottom" onClick={() => void onAdd()}>
          + Add slide
        </button>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete slide?"
          message="This slide and its notes will be permanently deleted."
          confirmLabel="Delete slide"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void onDelete(target.id);
          }}
        />
      )}
    </section>
  );
}
