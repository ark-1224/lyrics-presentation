import { mergeSettings, normalizeSettings } from "../shared/types.js";
import type { PresentationSettings, Video } from "../shared/types.js";
import type { Db } from "./db.js";

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
  settings: PresentationSettings;
}

/** A video row plus the on-disk filename (the filename is never sent to clients). */
export interface VideoRecord extends Video {
  filename: string;
}

interface VideoRow {
  id: number;
  name: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}
const toVideo = (r: VideoRow): VideoRecord => ({
  id: r.id,
  name: r.name,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  url: `/media/${r.id}`,
  createdAt: r.created_at,
});

interface PresentationRow {
  id: number;
  name: string;
  slide_count: number;
  updated_at: string;
}
interface SlideRow {
  id: number;
  presentation_id: number;
  position: number;
  lyrics: string;
  notes: string;
}

const toPresentation = (r: PresentationRow): Presentation => ({
  id: r.id,
  name: r.name,
  slideCount: r.slide_count,
  updatedAt: r.updated_at,
});
const toSlide = (r: SlideRow): Slide => ({
  id: r.id,
  presentationId: r.presentation_id,
  position: r.position,
  lyrics: r.lyrics,
  notes: r.notes,
});

const PRESENTATION_SELECT = `
  SELECT p.id, p.name, p.updated_at,
         (SELECT COUNT(*) FROM slides s WHERE s.presentation_id = p.id) AS slide_count
  FROM presentations p`;

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {}; // corrupt settings fall back to defaults instead of crashing
  }
}

/** All data access in one place so routes stay thin and tests can run against ":memory:". */
export function createRepo(db: Db) {
  const touch = db.prepare("UPDATE presentations SET updated_at = datetime('now') WHERE id = ?");

  function getPresentation(id: number): Presentation | undefined {
    const row = db.prepare(`${PRESENTATION_SELECT} WHERE p.id = ?`).get(id) as PresentationRow | undefined;
    return row && toPresentation(row);
  }

  function listSlides(presentationId: number): Slide[] {
    const rows = db
      .prepare("SELECT * FROM slides WHERE presentation_id = ? ORDER BY position")
      .all(presentationId) as SlideRow[];
    return rows.map(toSlide);
  }

  function getSlide(id: number): Slide | undefined {
    const row = db.prepare("SELECT * FROM slides WHERE id = ?").get(id) as SlideRow | undefined;
    return row && toSlide(row);
  }

  function getSettings(id: number): PresentationSettings | undefined {
    const row = db.prepare("SELECT settings FROM presentations WHERE id = ?").get(id) as { settings: string } | undefined;
    return row && normalizeSettings(safeParse(row.settings));
  }

  function getVideo(id: number): VideoRecord | undefined {
    const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as VideoRow | undefined;
    return row && toVideo(row);
  }

  /** Rewrite positions 0..n-1 so they stay contiguous after deletes. */
  function renumber(presentationId: number) {
    const ids = db
      .prepare("SELECT id FROM slides WHERE presentation_id = ? ORDER BY position, id")
      .all(presentationId) as { id: number }[];
    const update = db.prepare("UPDATE slides SET position = ? WHERE id = ?");
    ids.forEach((s, i) => update.run(i, s.id));
  }

  return {
    listPresentations(): Presentation[] {
      const rows = db
        .prepare(`${PRESENTATION_SELECT} ORDER BY p.name COLLATE NOCASE, p.id`)
        .all() as PresentationRow[];
      return rows.map(toPresentation);
    },

    getPresentation,

    getPresentationDetail(id: number): PresentationDetail | undefined {
      const p = getPresentation(id);
      return p && { ...p, slides: listSlides(id), settings: getSettings(id)! };
    },

    listSlides,
    getSlide,
    getSettings,

    /** Merge a partial settings patch into the stored settings (invalid values are corrected). */
    updateSettings(id: number, patch: unknown): PresentationSettings | undefined {
      const current = getSettings(id);
      if (!current) return undefined;
      const next = mergeSettings(current, patch);
      db.prepare("UPDATE presentations SET settings = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(next),
        id,
      );
      return next;
    },

    // ---- videos ----
    listVideos(): VideoRecord[] {
      return (db.prepare("SELECT * FROM videos ORDER BY name COLLATE NOCASE, id").all() as VideoRow[]).map(toVideo);
    },
    getVideo,
    /** videoId -> number of presentations that currently use it as their Main background. */
    videoUsage(): Map<number, number> {
      const usage = new Map<number, number>();
      const rows = db.prepare("SELECT settings FROM presentations").all() as { settings: string }[];
      for (const row of rows) {
        const id = normalizeSettings(safeParse(row.settings)).main.videoId;
        if (id !== null) usage.set(id, (usage.get(id) ?? 0) + 1);
      }
      return usage;
    },
    addVideo(v: { name: string; filename: string; mime: string; size: number }): VideoRecord {
      const info = db
        .prepare("INSERT INTO videos (name, filename, mime, size) VALUES (?, ?, ?, ?)")
        .run(v.name, v.filename, v.mime, v.size);
      return getVideo(Number(info.lastInsertRowid))!;
    },
    renameVideo(id: number, name: string): VideoRecord | undefined {
      return db.prepare("UPDATE videos SET name = ? WHERE id = ?").run(name, id).changes ? getVideo(id) : undefined;
    },
    /** Deletes the row and un-selects the video everywhere it was used. Returns the row so the caller can remove the file. */
    deleteVideo(id: number): VideoRecord | undefined {
      return db.transaction(() => {
        const v = getVideo(id);
        if (!v) return undefined;
        const rows = db.prepare("SELECT id, settings FROM presentations").all() as { id: number; settings: string }[];
        const update = db.prepare("UPDATE presentations SET settings = ? WHERE id = ?");
        for (const row of rows) {
          const s = normalizeSettings(safeParse(row.settings));
          if (s.main.videoId === id) update.run(JSON.stringify({ ...s, main: { ...s.main, videoId: null } }), row.id);
        }
        db.prepare("DELETE FROM videos WHERE id = ?").run(id);
        return v;
      })();
    },

    // ---- key/value ----
    getKv(key: string): string | undefined {
      return (db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
    },
    setKv(key: string, value: string) {
      db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        key,
        value,
      );
    },

    createPresentation(name: string): Presentation {
      const info = db.prepare("INSERT INTO presentations (name) VALUES (?)").run(name);
      return getPresentation(Number(info.lastInsertRowid))!;
    },

    renamePresentation(id: number, name: string): Presentation | undefined {
      const info = db
        .prepare("UPDATE presentations SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, id);
      return info.changes ? getPresentation(id) : undefined;
    },

    duplicatePresentation(id: number): Presentation | undefined {
      return db.transaction(() => {
        const src = getPresentation(id);
        if (!src) return undefined;
        const copy = db
          .prepare("INSERT INTO presentations (name, settings) SELECT ?, settings FROM presentations WHERE id = ?")
          .run(`${src.name} (copy)`, id);
        const newId = Number(copy.lastInsertRowid);
        db.prepare(
          `INSERT INTO slides (presentation_id, position, lyrics, notes)
           SELECT ?, position, lyrics, notes FROM slides WHERE presentation_id = ?`,
        ).run(newId, id);
        return getPresentation(newId);
      })();
    },

    deletePresentation(id: number): boolean {
      return db.prepare("DELETE FROM presentations WHERE id = ?").run(id).changes > 0;
    },

    addSlide(presentationId: number, lyrics = "", notes = ""): Slide | undefined {
      return db.transaction(() => {
        if (!getPresentation(presentationId)) return undefined;
        const next = db
          .prepare("SELECT COALESCE(MAX(position) + 1, 0) AS n FROM slides WHERE presentation_id = ?")
          .get(presentationId) as { n: number };
        const info = db
          .prepare("INSERT INTO slides (presentation_id, position, lyrics, notes) VALUES (?, ?, ?, ?)")
          .run(presentationId, next.n, lyrics, notes);
        touch.run(presentationId);
        return getSlide(Number(info.lastInsertRowid));
      })();
    },

    updateSlide(id: number, patch: { lyrics?: string; notes?: string }): Slide | undefined {
      return db.transaction(() => {
        const cur = getSlide(id);
        if (!cur) return undefined;
        db.prepare("UPDATE slides SET lyrics = ?, notes = ? WHERE id = ?").run(
          patch.lyrics ?? cur.lyrics,
          patch.notes ?? cur.notes,
          id,
        );
        touch.run(cur.presentationId);
        return getSlide(id);
      })();
    },

    deleteSlide(id: number): boolean {
      return db.transaction(() => {
        const cur = getSlide(id);
        if (!cur) return false;
        db.prepare("DELETE FROM slides WHERE id = ?").run(id);
        renumber(cur.presentationId);
        touch.run(cur.presentationId);
        return true;
      })();
    },

    /**
     * Apply a new slide order. `slideIds` must contain exactly the presentation's slide ids
     * (guards against a stale client silently dropping or duplicating slides).
     */
    reorderSlides(presentationId: number, slideIds: number[]): Slide[] | undefined {
      return db.transaction(() => {
        const existing = listSlides(presentationId).map((s) => s.id);
        const same =
          existing.length === slideIds.length &&
          new Set(slideIds).size === slideIds.length &&
          existing.every((id) => slideIds.includes(id));
        if (!same) return undefined;
        const update = db.prepare("UPDATE slides SET position = ? WHERE id = ?");
        slideIds.forEach((id, i) => update.run(i, id));
        touch.run(presentationId);
        return listSlides(presentationId);
      })();
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
