// Thin typed wrapper around the REST API. Mirrors server/repo.ts types.

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
}

export interface PresentationDetail extends Presentation {
  slides: Slide[];
}

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
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

  addSlide: (presentationId: number) => request<Slide>("POST", `/api/presentations/${presentationId}/slides`, {}),
  updateSlide: (id: number, patch: { lyrics?: string; notes?: string }) => request<Slide>("PATCH", `/api/slides/${id}`, patch),
  deleteSlide: (id: number) => request<void>("DELETE", `/api/slides/${id}`),
  reorderSlides: (presentationId: number, slideIds: number[]) =>
    request<Slide[]>("PUT", `/api/presentations/${presentationId}/slides/order`, { slideIds }),
};
