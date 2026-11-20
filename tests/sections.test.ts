import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SECTIONS, isSectionKey } from "../shared/types.js";
import { openDb } from "../server/db.js";
import { parseCommand } from "../server/ws.js";
import { makeTestApp } from "./helpers.js";

/** A typical song: Verse, Chorus, Verse, Chorus, Bridge, Chorus. Returns the pieces for assertions. */
function makeSong() {
  const t = makeTestApp();
  const p = t.repo.createPresentation("Song");
  const layout = [
    ["Verse 1", "verse"],
    ["Chorus", "chorus"],
    ["Verse 2", "verse"],
    ["Chorus again", "chorus"],
    ["Bridge", "bridge"],
    ["Final chorus", "chorus"],
    ["Unlabelled tag line", ""],
  ] as const;
  const slides = layout.map(([lyrics, section]) => {
    const s = t.repo.addSlide(p.id, lyrics)!;
    if (section) t.repo.updateSlide(s.id, { section });
    return s;
  });
  t.live.command({ type: "show", presentationId: p.id });
  const at = () => t.live.getInfo().slideIndex;
  return { ...t, p, slides, at };
}

describe("sections on slides (API)", () => {
  it("lists the available sections", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Intro", "Verse", "Pre-chorus", "Chorus", "Bridge", "Tag", "Outro"]);
    expect(isSectionKey("chorus")).toBe(true);
    expect(isSectionKey("Chorus")).toBe(false);
    expect(isSectionKey("")).toBe(false);
  });

  it("sets, returns and clears a slide's section without touching its text", async () => {
    const { app, repo } = makeTestApp();
    const p = repo.createPresentation("Song");
    const s = repo.addSlide(p.id, "Some lyrics", "a note")!;
    expect(s.section).toBe(""); // new slides start with no section

    const set = await request(app).patch(`/api/slides/${s.id}`).send({ section: "chorus" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ section: "chorus", lyrics: "Some lyrics", notes: "a note" });

    const detail = (await request(app).get(`/api/presentations/${p.id}`)).body;
    expect(detail.slides[0].section).toBe("chorus");

    // Saving text afterwards (the autosave sends lyrics + notes only) must not reset the section.
    await request(app).patch(`/api/slides/${s.id}`).send({ lyrics: "Edited", notes: "a note" });
    expect((await request(app).get(`/api/presentations/${p.id}`)).body.slides[0]).toMatchObject({ section: "chorus", lyrics: "Edited" });

    const cleared = await request(app).patch(`/api/slides/${s.id}`).send({ section: "" });
    expect(cleared.body.section).toBe("");
  });

  it("rejects unknown sections", async () => {
    const { app, repo } = makeTestApp();
    const s = repo.addSlide(repo.createPresentation("Song").id, "x")!;
    for (const bad of ["refrain", "CHORUS", 5, null, {}]) {
      const res = await request(app).patch(`/api/slides/${s.id}`).send({ section: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(repo.getSlide(s.id)?.section).toBe("");
  });

  it("is copied when a presentation is duplicated", async () => {
    const { app, repo } = makeTestApp();
    const p = repo.createPresentation("Song");
    const s = repo.addSlide(p.id, "Verse text")!;
    repo.updateSlide(s.id, { section: "verse" });
    const copy = (await request(app).post(`/api/presentations/${p.id}/duplicate`)).body;
    expect((await request(app).get(`/api/presentations/${copy.id}`)).body.slides[0].section).toBe("verse");
  });

  it("requires the password when one is set", async () => {
    const { app } = makeTestApp({ appPassword: "secret" });
    expect((await request(app).patch("/api/slides/1").send({ section: "verse" })).status).toBe(401);
  });
});

describe("database migration", () => {
  it("adds the section column to an existing database and keeps its data", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyrics-migrate-"));
    const first = openDb(dir);
    first.prepare("INSERT INTO presentations (name) VALUES ('Old song')").run();
    first.prepare("INSERT INTO slides (presentation_id, position, lyrics, notes) VALUES (1, 0, 'old lyrics', 'old notes')").run();
    first.close();

    // Turn it back into a database from before sections existed (schema version 2, no column).
    const raw = new Database(path.join(dir, "app.db"));
    raw.exec("ALTER TABLE slides DROP COLUMN section");
    raw.pragma("user_version = 2");
    raw.close();

    const upgraded = openDb(dir); // runs the migration
    const row = upgraded.prepare("SELECT lyrics, notes, section FROM slides").get() as { lyrics: string; notes: string; section: string };
    expect(row).toEqual({ lyrics: "old lyrics", notes: "old notes", section: "" });
    expect(upgraded.pragma("user_version", { simple: true })).toBe(3);
    upgraded.close();
  });
});

describe("jump to section (live)", () => {
  it("goes to the next slide of that section after the current one, then wraps around", () => {
    const { live, at } = makeSong();
    expect(at()).toBe(0); // starts on Verse 1

    live.command({ type: "section", section: "chorus" });
    expect(at()).toBe(1);
    live.command({ type: "section", section: "chorus" });
    expect(at()).toBe(3);
    live.command({ type: "section", section: "chorus" });
    expect(at()).toBe(5);
    live.command({ type: "section", section: "chorus" });
    expect(at()).toBe(1); // after the last chorus it wraps to the first
  });

  it("finds the next verse from a chorus, and the bridge from anywhere", () => {
    const { live, at, slides } = makeSong();
    live.command({ type: "goto", slideId: slides[3]!.id }); // on the second chorus
    live.command({ type: "section", section: "verse" });
    expect(at()).toBe(0); // no verse after it, so back to Verse 1
    live.command({ type: "goto", slideId: slides[1]!.id }); // first chorus
    live.command({ type: "section", section: "verse" });
    expect(at()).toBe(2); // Verse 2 is the next verse
    live.command({ type: "section", section: "bridge" });
    expect(at()).toBe(4);
    live.command({ type: "section", section: "bridge" });
    expect(at()).toBe(4); // the only bridge: stays put
  });

  it("changes nothing when no slide has that section, or nothing is live", () => {
    const { live, at } = makeSong();
    live.command({ type: "section", section: "outro" });
    expect(at()).toBe(0);

    const idle = makeTestApp();
    idle.repo.addSlide(idle.repo.createPresentation("x").id, "y");
    idle.live.command({ type: "section", section: "verse" });
    expect(idle.live.getInfo().presentationId).toBeNull();
  });

  it("follows relabelling: the jump list and buttons see changes right away", async () => {
    const { live, slides, repo, p } = makeSong();
    expect(live.getInfo().slides.map((s) => s.section)).toEqual(["verse", "chorus", "verse", "chorus", "bridge", "chorus", ""]);

    repo.updateSlide(slides[6]!.id, { section: "outro" });
    live.refresh();
    expect(live.getInfo().slides[6]?.section).toBe("outro");
    live.command({ type: "section", section: "outro" });
    expect(live.getInfo().slideIndex).toBe(6);
    expect(repo.getPresentation(p.id)?.slideCount).toBe(7);
  });

  it("keeps working after slides are reordered (it uses the current order)", () => {
    const { live, slides, repo, p, at } = makeSong();
    // Move the bridge to the very front.
    const order = [slides[4]!, ...slides.filter((_, i) => i !== 4)].map((s) => s.id);
    repo.reorderSlides(p.id, order);
    live.refresh();
    live.command({ type: "goto", slideId: slides[6]!.id });
    live.command({ type: "section", section: "bridge" });
    expect(at()).toBe(0);
  });
});

describe("section command over the socket protocol", () => {
  it("accepts known sections only", () => {
    expect(parseCommand('{"type":"section","section":"chorus"}')).toEqual({ type: "section", section: "chorus" });
    expect(parseCommand('{"type":"section","section":"pre-chorus"}')).toEqual({ type: "section", section: "pre-chorus" });
    for (const bad of ['{"type":"section"}', '{"type":"section","section":"refrain"}', '{"type":"section","section":""}', '{"type":"section","section":7}']) {
      expect(parseCommand(bad), bad).toBeUndefined();
    }
  });
});
