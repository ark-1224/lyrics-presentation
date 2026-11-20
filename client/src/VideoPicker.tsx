import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Video } from "./api";

interface Props {
  videos: Video[];
  selectedId: number | null;
  maxUploadMb: number;
  onSelect: (videoId: number | null) => void;
  /** Should throw an Error with a readable message if the upload fails. */
  onUpload: (file: File) => Promise<void>;
}

/** Choose this presentation's background video, or upload a new one. (Full video management arrives in step d.) */
export function VideoPicker({ videos, selectedId, maxUploadMb, onSelect, onUpload }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    setError("");
    // Check the size here first so an oversized file doesn't waste a long upload.
    if (file.size > maxUploadMb * 1024 * 1024) {
      setError(`“${file.name}” is ${(file.size / 1024 / 1024).toFixed(0)} MB, which is over the ${maxUploadMb} MB limit.`);
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-picker">
      <label>
        Background video (Main display)
        <select value={selectedId ?? ""} onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None (black)</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? "Uploading…" : "Upload video…"}
      </button>
      <input ref={fileInput} type="file" accept=".mp4,.webm,video/mp4,video/webm" hidden onChange={chosen} />
      <span className="muted">mp4 or webm, up to {maxUploadMb} MB</span>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
