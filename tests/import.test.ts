import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PptxPreview } from "../shared/types.js";
import { makeTestApp } from "./helpers.js";

const SAMPLE = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "sample.pptx"));

describe("POST /api/import/pptx (preview)", () => {
  it("parses the sample file and returns every slide without saving anything", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/import/pptx").attach("file", SAMPLE, "Sunday Songs.pptx");
    expect(res.status).toBe(200);
    const preview = res.body as PptxPreview;
    expect(preview.fileName).toBe("Sunday Songs.pptx");
    expect(preview.suggestedName).toBe("Sunday Songs");
    expect(preview.slides).toHaveLength(6);
    expect(preview.slides[0]).toMatchObject({ number: 1, notes: "Start soft, piano only", empty: false });
    expect(preview.slides[2]).toMatchObject({ number: 3, empty: true });
    expect(preview.slides[4]).toMatchObject({ number: 5, hidden: true });

    expect((await request(app).get("/api/presentations")).body).toEqual([]); // preview stores nothing
  });

  it("accepts the .pptx extension in any letter case", async () => {
    const { app } = makeTestApp();
    expect((await request(app).post("/api/import/pptx").attach("file", SAMPLE, "SONGS.PPTX")).status).toBe(200);
  });

  it("refuses other file types with a helpful message", async () => {
    const { app } = makeTestApp();
    const txt = await request(app).post("/api/import/pptx").attach("file", Buffer.from("hello"), "lyrics.txt");
    expect(txt.status).toBe(400);
    expect(txt.body.error).toBe("Please choose a PowerPoint .pptx file.");

    const ppt = await request(app).post("/api/import/pptx").attach("file", Buffer.from("x"), "old.ppt");
    expect(ppt.status).toBe(400);
    expect(ppt.body.error).toMatch(/Old \.ppt files can't be imported.*Save As/);

    expect((await request(app).post("/api/import/pptx").field("a", "b")).status).toBe(400);
    expect((await request(app).post("/api/import/pptx").send({ x: 1 })).status).toBe(400);
  });

  it("rejects corrupted or fake .pptx files with a clear message", async () => {
    const { app } = makeTestApp();
    const fake = await request(app).post("/api/import/pptx").attach("file", Buffer.from("not really a presentation"), "fake.pptx");
    expect(fake.status).toBe(422);
    expect(fake.body.error).toMatch(/isn't a PowerPoint/);

    const truncated = await request(app).post("/api/import/pptx").attach("file", SAMPLE.subarray(0, 4000), "cut.pptx");
    expect(truncated.status).toBe(422);
    expect(truncated.body.error).toBeTruthy();

    const docx = zipSync({ "word/document.xml": strToU8("<w:document/>") });
    const word = await request(app).post("/api/import/pptx").attach("file", Buffer.from(docx), "report.pptx");
    expect(word.status).toBe(422);
    expect(word.body.error).toMatch(/not a PowerPoint presentation/);
  });

  it("enforces the size limit", async () => {
    const { app } = makeTestApp({ maxPptxMb: 0.001 }); // ~1 KB, smaller than the sample
    const res = await request(app).post("/api/import/pptx").attach("file", SAMPLE, "big.pptx");
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("That file is larger than the 0.001 MB limit for importing.");
  });

  it("requires the password when one is set", async () => {
    const { app } = makeTestApp({ appPassword: "secret" });
    expect((await request(app).post("/api/import/pptx").attach("file", SAMPLE, "a.pptx")).status).toBe(401);
    expect((await request(app).post("/api/import").send({ name: "x", slides: [] })).status).toBe(401);
  });
});

describe("POST /api/import (save)", () => {
  it("creates the presentation with slides and notes in the given order", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/import")
      .send({
        name: "  Sunday Songs ",
        slides: [
          { lyrics: "First", notes: "n1" },
          { lyrics: "", notes: "" }, // an empty slide the operator chose to keep
          { lyrics: "Third\nline two", notes: "" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Sunday Songs", slideCount: 3 });

    const detail = (await request(app).get(`/api/presentations/${res.body.id}`)).body;
    expect(detail.slides.map((s: { lyrics: string; notes: string; position: number }) => [s.lyrics, s.notes, s.position])).toEqual([
      ["First", "n1", 0],
      ["", "", 1],
      ["Third\nline two", "", 2],
    ]);
  });

  it("works end to end: preview the sample, drop the empty slide, save", async () => {
    const { app } = makeTestApp();
    const preview = (await request(app).post("/api/import/pptx").attach("file", SAMPLE, "sample.pptx")).body as PptxPreview;
    const keep = preview.slides.filter((s) => !s.empty && !s.hidden).map(({ lyrics, notes }) => ({ lyrics, notes }));
    const saved = await request(app).post("/api/import").send({ name: preview.suggestedName, slides: keep });
    expect(saved.status).toBe(201);
    expect(saved.body.slideCount).toBe(4);
    const detail = (await request(app).get(`/api/presentations/${saved.body.id}`)).body;
    expect(detail.slides[0].notes).toBe("Start soft, piano only");
  });

  it("rejects bad requests and creates nothing", async () => {
    const { app } = makeTestApp();
    const bad = [
      { name: "", slides: [{ lyrics: "a", notes: "" }] },
      { slides: [{ lyrics: "a", notes: "" }] },
      { name: "x", slides: [] },
      { name: "x" },
      { name: "x", slides: "nope" },
      { name: "x", slides: [{ lyrics: 5, notes: "" }] },
      { name: "x", slides: [{ lyrics: "ok", notes: "" }, { lyrics: "x".repeat(10_001), notes: "" }] },
      { name: "x", slides: Array.from({ length: 1001 }, () => ({ lyrics: "a", notes: "" })) },
    ];
    for (const body of bad) expect((await request(app).post("/api/import").send(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect((await request(app).get("/api/presentations")).body).toEqual([]); // all-or-nothing: no half-made presentation
  });
});
