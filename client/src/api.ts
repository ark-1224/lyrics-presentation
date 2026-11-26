// Thin typed wrapper around the REST API. Mirrors server/repo.ts types.
import type { CustomSection, ImportRequest, PptxPreview, PresentationSettings, SectionId, SlideSection, Video } from "../../shared/types";

export type { PresentationSettings, Video };

export interface Presentation {
  id: number;
  name: string;
  slideCount: number;
  updatedAt: string;
}

export interface Slide {
  id: number;
  presentationId: number;
  position: number;
  lyrics: string;
  notes: string;
  section: SlideSection;
}

export interface PresentationDetail extends Presentation {
  slides: Slide[];
  settings: PresentationSettings;
}

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
}

/** Settings patch: any subset of fields of main/singers. */
export interface DeepPartialSettings {
  main?: Partial<PresentationSettings["main"]>;
  singers?: Partial<PresentationSettings["singers"]>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | undefined;
/** The control panel registers this so any 401 sends the operator back to the login screen. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  if (res.status === 401 && url !== "/api/login") onUnauthorized?.();
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  session: () => request<SessionInfo>("GET", "/api/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),

  listPresentations: () => request<Presentation[]>("GET", "/api/presentations"),
  getPresentation: (id: number) => request<PresentationDetail>("GET", `/api/presentations/${id}`),
  createPresentation: (name: string) => request<Presentation>("POST", "/api/presentations", { name }),
  renamePresentation: (id: number, name: string) => request<Presentation>("PATCH", `/api/presentations/${id}`, { name }),
  duplicatePresentation: (id: number) => request<Presentation>("POST", `/api/presentations/${id}/duplicate`),
  deletePresentation: (id: number) => request<void>("DELETE", `/api/presentations/${id}`),

  updateSettings: (id: number, patch: DeepPartialSettings) =>
    request<PresentationSettings>("PUT", `/api/presentations/${id}/settings`, patch),

  listVideos: () => request<{ videos: Video[]; maxUploadMb: number }>("GET", "/api/videos"),
  deleteVideo: (id: number) => request<void>("DELETE", `/api/videos/${id}`),
  renameVideo: (id: number, name: string) => request<Video>("PATCH", `/api/videos/${id}`, { name }),
  /**
   * Multipart upload with progress (fetch can't report upload progress, XMLHttpRequest can).
   * The browser sets the multipart Content-Type boundary itself. `onProgress` gets 0..1.
   */
  uploadVideo(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Video> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/videos");
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new ApiError("Upload failed. Check your connection and try again.", 0));
      xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));
      xhr.onload = () => {
        const body = xhr.response as (Video & { error?: string }) | null;
        if (xhr.status === 401) onUnauthorized?.();
        if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body);
        // A proxy in front of the server may answer 413 with a plain page instead of our JSON.
        const fallback = xhr.status === 413 ? "The server rejected the file as too large." : `Upload failed (${xhr.status})`;
        reject(new ApiError(body?.error ?? fallback, xhr.status));
      };
      signal?.addEventListener("abort", () => xhr.abort());
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },

  /** Upload a .pptx and get back what was found in it. Nothing is saved yet. */
  async importPptx(file: File): Promise<PptxPreview> {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/import/pptx", { method: "POST", body: form });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
    }
    if (res.status === 401) onUnauthorized?.();
    const data = (await res.json().catch(() => null)) as (PptxPreview & { error?: string }) | null;
    if (!res.ok || !data) {
      const fallback = res.status === 413 ? "The server rejected the file as too large." : `Import failed (${res.status})`;
      throw new ApiError(data?.error ?? fallback, res.status);
    }
    return data;
  },
  /** Create the presentation from the reviewed slides. */
  importPresentation: (req: ImportRequest) => request<Presentation>("POST", "/api/import", req),

  addSlide: (presentationId: number) => request<Slide>("POST", `/api/presentations/${presentationId}/slides`, {}),
  renameSection: (presentationId: number, from: CustomSection, to: SectionId) =>
    request<Slide[]>("PATCH", `/api/presentations/${presentationId}/sections`, { from, to }),
  updateSlide: (id: number, patch: { lyrics?: string; notes?: string; section?: SlideSection }) => request<Slide>("PATCH", `/api/slides/${id}`, patch),
  deleteSlide: (id: number) => request<void>("DELETE", `/api/slides/${id}`),
  reorderSlides: (presentationId: number, slideIds: number[]) =>
    request<Slide[]>("PUT", `/api/presentations/${presentationId}/slides/order`, { slideIds }),
};
