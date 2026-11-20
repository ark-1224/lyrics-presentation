import { MAX_PPTX_MB } from "../../shared/types";

/** "442702" -> "432 KB", "52428800" -> "50.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Quick checks before uploading a PowerPoint file. The server repeats them. Returns a message or null. */
export function checkPptxFile(file: { name: string; size: number }): string | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ppt")) {
    return `“${file.name}” is an old-format .ppt file. Open it in PowerPoint and use Save As → PowerPoint Presentation (.pptx).`;
  }
  if (!lower.endsWith(".pptx")) return `“${file.name}” isn't a PowerPoint .pptx file.`;
  if (file.size > MAX_PPTX_MB * 1024 * 1024) {
    return `“${file.name}” is ${formatBytes(file.size)}, which is over the ${MAX_PPTX_MB} MB limit for importing.`;
  }
  return null;
}

const ALLOWED_EXTENSIONS = [".mp4", ".webm"];

/**
 * Quick checks before starting an upload, so a wrong or oversized file fails instantly with a
 * clear message instead of after a long upload. The server repeats these checks.
 * Returns an error message, or null if the file looks fine.
 */
export function checkVideoFile(file: { name: string; size: number }, maxUploadMb: number): string | null {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `“${file.name}” isn't supported. Only .mp4 and .webm videos can be uploaded.`;
  }
  if (file.size > maxUploadMb * 1024 * 1024) {
    return `“${file.name}” is ${formatBytes(file.size)}, which is over the ${maxUploadMb} MB limit.`;
  }
  return null;
}
