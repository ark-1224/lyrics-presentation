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
}

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
      return p && { ...p, slides: listSlides(id) };
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
