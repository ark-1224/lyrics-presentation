import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { PptxPreview } from "../../shared/types";
import { api } from "./api";
import type { Presentation } from "./api";
import { checkPptxFile } from "./format";

interface Row {
  number: number;
  lyrics: string;
  notes: string;
  empty: boolean;
  hidden: boolean;
  include: boolean;
}

interface ReviewProps {
  preview: PptxPreview;
  onCancel: () => void;
  /** Creates the presentation; should throw an Error with a readable message on failure. */
  onSave: (name: string, slides: { lyrics: string; notes: string }[]) => Promise<void>;
}

/** The review screen: see what was found, fix text, drop slides, rename, then import. */
function ReviewDialog({ preview, onCancel, onSave }: ReviewProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(preview.suggestedName);
  // Empty slides start unchecked ("skipped"); everything else is included.
  const [rows, setRows] = useState<Row[]>(() => preview.slides.map((s) => ({ ...s, include: !s.empty })));
  const [openNotes, setOpenNotes] = useState<Set<number>>(() => new Set(preview.slides.filter((s) => s.notes).map((s) => s.number)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const update = (number: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.number === number ? { ...r, ...patch } : r)));
  const included = rows.filter((r) => r.include);
  const emptyCount = rows.filter((r) => r.empty).length;
  const hiddenCount = rows.filter((r) => r.hidden).length;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim(), included.map((r) => ({ lyrics: r.lyrics, notes: r.notes })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} className="import-dialog" onCancel={onCancel} aria-labelledby="import-title">
      <div className="import-head">
        <h2 id="import-title">Review import</h2>
        <span className="muted">from {preview.fileName}</span>
      </div>

      <label className="field import-name">
        <span>Presentation name</span>
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="import-summary">
        <strong>
          {included.length} of {rows.length} slides will be imported
        </strong>
        {emptyCount > 0 && <span className="muted"> · {emptyCount} empty (skipped unless you tick them)</span>}
        {hiddenCount > 0 && <span className="muted"> · {hiddenCount} hidden in PowerPoint</span>}
        <span className="import-bulk">
          <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>
            Include all
          </button>
          <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>
            Include none
          </button>
        </span>
      </div>
      <p className="muted import-note">Only text and speaker notes are imported. Pictures, shapes and PowerPoint styling are ignored. You can edit any text here.</p>

      <ol className="import-rows">
        {rows.map((r) => (
          <li key={r.number} className={r.include ? "" : "excluded"}>
            <div className="import-row-head">
              <label className="include">
                <input type="checkbox" checked={r.include} onChange={(e) => update(r.number, { include: e.target.checked })} />
                <strong>Slide {r.number}</strong>
              </label>
              {r.empty && <span className="flag">Empty</span>}
              {r.hidden && <span className="flag">Hidden in PowerPoint</span>}
              <button
                type="button"
                className="notes-toggle"
                aria-expanded={openNotes.has(r.number)}
                onClick={() =>
                  setOpenNotes((s) => {
                    const next = new Set(s);
                    if (next.has(r.number)) next.delete(r.number);
                    else next.add(r.number);
                    return next;
                  })
                }
              >
                {openNotes.has(r.number) ? "Hide notes" : r.notes ? "Show notes" : "Add notes"}
              </button>
            </div>
            <textarea
              value={r.lyrics}
              rows={Math.max(2, Math.min(r.lyrics.split("\n").length + 1, 10))}
              placeholder="(no text on this slide)"
              aria-label={`Lyrics for slide ${r.number}`}
              onChange={(e) => update(r.number, { lyrics: e.target.value, empty: e.target.value.trim() === "" })}
            />
            {openNotes.has(r.number) && (
              <textarea
                className="notes"
                value={r.notes}
                rows={2}
                placeholder="Private notes (never shown on the displays)"
                aria-label={`Private notes for slide ${r.number}`}
                onChange={(e) => update(r.number, { notes: e.target.value })}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="import-foot">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={saving || included.length === 0 || name.trim() === ""}>
          {saving ? "Importing…" : `Import ${included.length} slide${included.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </dialog>
  );
}

/** "Import PowerPoint…" button: pick a .pptx, review it, then it becomes a new presentation. */
export function PptxImport({ onImported }: { onImported: (p: Presentation) => void | Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PptxPreview | null>(null);

  async function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    const problem = checkPptxFile(file);
    if (problem) return setError(problem);
    setError("");
    setBusy(true);
    try {
      setPreview(await api.importPptx(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pptx-import">
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? "Reading file…" : "Import PowerPoint (.pptx)…"}
      </button>
      <input ref={fileInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden onChange={chosen} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <ReviewDialog
          preview={preview}
          onCancel={() => setPreview(null)}
          onSave={async (name, slides) => {
            const created = await api.importPresentation({ name, slides });
            setPreview(null);
            await onImported(created);
          }}
        />
      )}
    </div>
  );
}
