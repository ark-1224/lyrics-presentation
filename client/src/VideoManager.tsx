import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Video } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { checkVideoFile, formatBytes } from "./format";

interface Props {
  videos: Video[];
  maxUploadMb: number;
  /** URL of the video playing on the Main display right now, if any (deleting it affects the show). */
  liveVideoUrl: string | null;
  /** Should throw an Error with a readable message on failure. */
  onUpload: (file: File, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/** Modal player so the operator can check a video (it plays muted and loops, like on the display). */
function PreviewDialog({ video, onClose }: { video: Video; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="preview-dialog" onCancel={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={`Preview of ${video.name}`}>
      <video src={video.url} controls autoPlay muted loop playsInline />
      <div className="preview-dialog-bar">
        <strong>{video.name}</strong>
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** The library of uploaded background videos: upload, preview, rename, delete. */
export function VideoManager({ videos, maxUploadMb, liveVideoUrl, onUpload, onRename, onDelete }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; fraction: number } | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<Video | null>(null);
  const [deleting, setDeleting] = useState<Video | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    const problem = checkVideoFile(file, maxUploadMb);
    if (problem) return setError(problem);
    setError("");
    const controller = new AbortController();
    setAbort(controller);
    setUpload({ name: file.name, fraction: 0 });
    try {
      await onUpload(file, (fraction) => setUpload({ name: file.name, fraction }), controller.signal);
    } catch (err) {
      // A cancel is the operator's own choice, so it isn't shown as an error.
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUpload(null);
      setAbort(null);
    }
  }

  async function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    const current = videos.find((v) => v.id === id);
    if (id !== null && name && current && name !== current.name) await onRename(id, name);
  }

  const deleteWarning = (v: Video) => {
    const parts = [`“${v.name}” will be permanently deleted. This can't be undone.`];
    if (v.usedBy) parts.push(`${v.usedBy} presentation${v.usedBy === 1 ? " uses" : "s use"} it and will go back to no background video.`);
    if (liveVideoUrl === v.url) parts.push("It is playing on the Main display right now, which will fade to black.");
    return parts.join(" ");
  };

  return (
    <section className="editor video-manager" aria-label="Background videos">
      <div className="editor-head">
        <h2>Background videos</h2>
        <span className="muted">
          {videos.length} video{videos.length === 1 ? "" : "s"}
        </span>
        <button type="button" className="primary add-top" disabled={upload !== null} onClick={() => fileInput.current?.click()}>
          Upload video…
        </button>
        <input ref={fileInput} type="file" accept=".mp4,.webm,video/mp4,video/webm" hidden onChange={chosen} />
      </div>
      <p className="muted hint">mp4 or webm, up to {maxUploadMb} MB each. Short, seamless loops work best. Videos are shared by all presentations.</p>

      {upload && (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="upload-line">
            <span>
              Uploading “{upload.name}” – {Math.round(upload.fraction * 100)}%
              {upload.fraction >= 1 && " (finishing…)"}
            </span>
            <button type="button" onClick={() => abort?.abort()}>
              Cancel
            </button>
          </div>
          <progress max={1} value={upload.fraction} />
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {videos.length === 0 && !upload && <p className="muted empty">No videos yet. Upload one to use as a looping background.</p>}

      <ul className="video-list">
        {videos.map((v) => (
          <li key={v.id}>
            <div className="video-info">
              {renamingId === v.id ? (
                <input
                  className="rename"
                  value={renameValue}
                  autoFocus
                  maxLength={100}
                  aria-label={`Rename ${v.name}`}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
              ) : (
                <span className="video-name">
                  {v.name}
                  {liveVideoUrl === v.url && <span className="live-badge">ON MAIN DISPLAY</span>}
                </span>
              )}
              <span className="muted">
                {formatBytes(v.size)} · {v.mime.replace("video/", "")} ·{" "}
                {v.usedBy ? `used by ${v.usedBy} presentation${v.usedBy === 1 ? "" : "s"}` : "not used"}
              </span>
            </div>
            <span className="row-actions">
              <button type="button" onClick={() => setPreviewing(v)} aria-label={`Preview ${v.name}`}>
                Preview
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenamingId(v.id);
                  setRenameValue(v.name);
                }}
                aria-label={`Rename ${v.name}`}
              >
                Rename
              </button>
              <button type="button" className="danger-text" onClick={() => setDeleting(v)} aria-label={`Delete ${v.name}`}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>

      {previewing && <PreviewDialog video={previewing} onClose={() => setPreviewing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete video?"
          message={deleteWarning(deleting)}
          confirmLabel="Delete video"
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
