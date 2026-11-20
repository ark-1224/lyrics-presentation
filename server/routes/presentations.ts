import { Router } from "express";
import type { Repo } from "../repo.js";

export const MAX_NAME = 200;
export const MAX_TEXT = 10_000; // lyrics or notes per slide

function parseId(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 && name.length <= MAX_NAME ? name : undefined;
}

/** Returns the string if valid, undefined if absent, null if present but invalid. */
function optionalText(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && raw.length <= MAX_TEXT ? raw : null;
}

/**
 * `onChange` is called after every edit that could affect what is on the screens
 * (rename, slide edits, reorder, settings, delete) so the live state can refresh.
 */
export function presentationRoutes(repo: Repo, onChange: () => void): Router {
  const r = Router();

  r.get("/presentations", (_req, res) => {
    res.json(repo.listPresentations());
  });

  r.post("/presentations", (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return void res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters)` });
    res.status(201).json(repo.createPresentation(name));
  });

  r.get("/presentations/:id", (req, res) => {
    const id = parseId(req.params.id);
    const detail = id && repo.getPresentationDetail(id);
    if (!detail) return void res.status(404).json({ error: "Presentation not found" });
    res.json(detail);
  });

  r.patch("/presentations/:id", (req, res) => {
    const id = parseId(req.params.id);
    const name = cleanName(req.body?.name);
    if (!name) return void res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters)` });
    const updated = id && repo.renamePresentation(id, name);
    if (!updated) return void res.status(404).json({ error: "Presentation not found" });
    onChange();
    res.json(updated);
  });

  // Styling + background video. Send only the fields to change, e.g. {"main": {"fontSize": 9}}.
  // Invalid values are corrected (clamped / reset to defaults) rather than rejected.
  r.put("/presentations/:id/settings", (req, res) => {
    const id = parseId(req.params.id);
    const settings = id && repo.updateSettings(id, req.body);
    if (!settings) return void res.status(404).json({ error: "Presentation not found" });
    onChange();
    res.json(settings);
  });

  r.post("/presentations/:id/duplicate", (req, res) => {
    const id = parseId(req.params.id);
    const copy = id && repo.duplicatePresentation(id);
    if (!copy) return void res.status(404).json({ error: "Presentation not found" });
    res.status(201).json(copy);
  });

  r.delete("/presentations/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !repo.deletePresentation(id)) return void res.status(404).json({ error: "Presentation not found" });
    onChange();
    res.status(204).end();
  });

  r.post("/presentations/:id/slides", (req, res) => {
    const id = parseId(req.params.id);
    const lyrics = optionalText(req.body?.lyrics);
    const notes = optionalText(req.body?.notes);
    if (lyrics === null || notes === null) return void res.status(400).json({ error: "Text is too long" });
    const slide = id && repo.addSlide(id, lyrics, notes);
    if (!slide) return void res.status(404).json({ error: "Presentation not found" });
    onChange();
    res.status(201).json(slide);
  });

  // Reorder: body is the complete list of slide ids in the new order.
  r.put("/presentations/:id/slides/order", (req, res) => {
    const id = parseId(req.params.id);
    const ids: unknown = req.body?.slideIds;
    if (!id || !Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
      return void res.status(400).json({ error: "slideIds must be a list of slide ids" });
    }
    const slides = repo.reorderSlides(id, ids as number[]);
    if (!slides) {
      return void res.status(409).json({ error: "Slide list is out of date. Reload and try again." });
    }
    onChange();
    res.json(slides);
  });

  r.patch("/slides/:id", (req, res) => {
    const id = parseId(req.params.id);
    const lyrics = optionalText(req.body?.lyrics);
    const notes = optionalText(req.body?.notes);
    if (lyrics === null || notes === null) return void res.status(400).json({ error: "Text is too long" });
    const slide = id && repo.updateSlide(id, { lyrics, notes });
    if (!slide) return void res.status(404).json({ error: "Slide not found" });
    onChange();
    res.json(slide);
  });

  r.delete("/slides/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !repo.deleteSlide(id)) return void res.status(404).json({ error: "Slide not found" });
    onChange();
    res.status(204).end();
  });

  return r;
}
