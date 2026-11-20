/** "442702" -> "432 KB", "52428800" -> "50.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
