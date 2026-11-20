import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS, PptxError, normalizeText, parsePptx } from "../server/pptx/parser.js";
import { buildPptx } from "./fixtures/pptx-builder.js";
import type { SlideSpec } from "./fixtures/pptx-builder.js";

const SAMPLE = path.join(import.meta.dirname, "fixtures", "sample.pptx");
const lyricsOf = (slides: SlideSpec[], opts: Parameters<typeof buildPptx>[0] extends infer T ? Partial<T> : never = {}) =>
  parsePptx(buildPptx({ slides, ...opts })).map((s) => s.lyrics);

describe("sample.pptx (6 slides: notes, an empty slide, a hidden slide)", () => {
  const slides = parsePptx(fs.readFileSync(SAMPLE));

  it("returns the slides in show order with text and notes", () => {
    expect(slides).toHaveLength(6);
    expect(slides.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(slides[0]).toMatchObject({
      lyrics: "Amazing Grace\nAmazing grace, how sweet the sound\nThat saved a wretch like me",
      notes: "Start soft, piano only",
    });
    expect(slides[1]).toMatchObject({ lyrics: "I once was lost, but now am found\nWas blind, but now I see", notes: "" });
    expect(slides[3]).toMatchObject({
      lyrics: "'Twas grace that taught my heart to fear\n\nAnd grace my fears relieved",
      notes: "Band comes in here\nCue the lights",
    });
  });

  it("flags the empty slide instead of dropping it", () => {
    expect(slides[2]).toMatchObject({ number: 3, lyrics: "", empty: true });
    expect(slides.filter((s) => s.empty)).toHaveLength(1);
  });

  it("flags the hidden slide but keeps its text", () => {
    expect(slides[4]).toMatchObject({ hidden: true, empty: false, lyrics: "Skipped verse (hidden in PowerPoint)" });
    expect(slides.filter((s) => s.hidden)).toHaveLength(1);
  });

  it("ignores footers, slide numbers, picture alt text and the notes page's slide number", () => {
    const all = JSON.stringify(slides);
    expect(all).not.toContain("Grace Community Church"); // footer placeholder
    expect(all).not.toContain("‹#›"); // slide number field
    expect(all).not.toContain("ALT-TEXT-MUST-BE-IGNORED");
    expect(slides[5]!.notes).toBe("Repeat twice");
  });

  it("decodes special characters and keeps number-like text as text", () => {
    expect(slides[5]!.lyrics).toBe("Chorus: Praise & worship — ♪\n1984 <3 \"quotes\" 'apostrophe'");
  });
});

describe("slide order and file layout", () => {
  it("follows presentation.xml, not the slide file names", () => {
    const slides: SlideSpec[] = [{ shapes: [{ paragraphs: ["first"] }] }, { shapes: [{ paragraphs: ["second"] }] }, { shapes: [{ paragraphs: ["third"] }] }];
    expect(lyricsOf(slides, { reverseFileNames: true })).toEqual(["first", "second", "third"]);
  });

  it("accepts absolute relationship targets (written by some exporters)", () => {
    const slides: SlideSpec[] = [{ shapes: [{ paragraphs: ["a"] }], notes: ["note a"] }, { shapes: [{ paragraphs: ["b"] }] }];
    const parsed = parsePptx(buildPptx({ slides, absoluteTargets: true }));
    expect(parsed.map((s) => [s.lyrics, s.notes])).toEqual([["a", "note a"], ["b", ""]]);
  });

  it("handles slides without a notes page and notes pages holding only a slide number", () => {
    const parsed = parsePptx(buildPptx({ slides: [{ shapes: [{ paragraphs: ["x"] }] }, { shapes: [{ paragraphs: ["y"] }], notes: [], notesSlideNumber: true }] }));
    expect(parsed.map((s) => s.notes)).toEqual(["", ""]);
  });

  it("copes with a different namespace prefix", () => {
    const slide =
      '<?xml version="1.0"?><pml:sld xmlns:pml="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:dml="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      "<pml:cSld><pml:spTree><pml:sp><pml:txBody><dml:p><dml:r><dml:t>prefixed text</dml:t></dml:r></dml:p></pml:txBody></pml:sp></pml:spTree></pml:cSld></pml:sld>";
    expect(parsePptx(buildPptx({ slides: [{}], parts: { "ppt/slides/slide1.xml": slide } }))[0]!.lyrics).toBe("prefixed text");
  });
});

describe("text extraction details", () => {
  it("keeps spaces between runs and inside text", () => {
    const slide =
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>' +
      "<a:p><a:r><a:t>Amazing </a:t></a:r><a:r><a:t>grace</a:t></a:r><a:r><a:t> how  sweet</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>";
    expect(parsePptx(buildPptx({ slides: [{}], parts: { "ppt/slides/slide1.xml": slide } }))[0]!.lyrics).toBe("Amazing grace how  sweet");
  });

  it("ignores indentation whitespace in pretty-printed XML", () => {
    const slide = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:t>Only this</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    expect(parsePptx(buildPptx({ slides: [{}], parts: { "ppt/slides/slide1.xml": slide } }))[0]!.lyrics).toBe("Only this");
  });

  it("keeps numbers and leading zeros as text", () => {
    expect(lyricsOf([{ shapes: [{ paragraphs: ["1984", "007", "3.50", "1e3", "true"] }] }])).toEqual(["1984\n007\n3.50\n1e3\ntrue"]);
  });

  it("reads text inside tables and groups, in order", () => {
    const table =
      '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>cell A</a:t></a:r></a:p></a:txBody></a:tc>' +
      "<a:tc><a:txBody><a:p><a:r><a:t>cell B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
    const group = '<p:grpSp><p:sp><p:txBody><a:p><a:r><a:t>in a group</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>';
    expect(lyricsOf([{ shapes: [{ paragraphs: ["before"] }], extraXml: table + group }])).toEqual(["before\ncell A\ncell B\nin a group"]);
  });

  it("uses only one copy of content wrapped in AlternateContent", () => {
    const alt =
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x"><p:sp><p:txBody><a:p><a:r><a:t>new style</a:t></a:r></a:p></p:txBody></p:sp></mc:Choice>' +
      "<mc:Fallback><p:sp><p:txBody><a:p><a:r><a:t>fallback copy</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>";
    expect(lyricsOf([{ extraXml: alt }])).toEqual(["new style"]);
  });

  it("skips date, footer and slide-number placeholders but keeps ordinary text boxes", () => {
    expect(
      lyricsOf([{ shapes: [{ kind: "dt", paragraphs: ["Nov 21"] }, { kind: "ftr", paragraphs: ["Footer"] }, { kind: "sldNum" }, { kind: "textbox", paragraphs: ["Footer"] }] }]),
    ).toEqual(["Footer"]); // only the plain text box counts, even though its text equals the footer's
  });

  it("treats soft line breaks and paragraphs as new lines", () => {
    expect(lyricsOf([{ shapes: [{ paragraphs: ["line one\nline two", "line three"] }] }])).toEqual(["line one\nline two\nline three"]);
  });

  it("keeps non-Latin text and emoji", () => {
    expect(lyricsOf([{ shapes: [{ paragraphs: ["主はわが羊飼い", "Señor, tú eres mi pastor 🙏"] }] }])).toEqual(["主はわが羊飼い\nSeñor, tú eres mi pastor 🙏"]);
  });

  it("treats whitespace-only slides as empty", () => {
    const [slide] = parsePptx(buildPptx({ slides: [{ shapes: [{ paragraphs: ["   ", " ", ""] }] }] }));
    expect(slide).toMatchObject({ lyrics: "", empty: true });
  });
});

describe("normalizeText", () => {
  it("trims lines, collapses blank-line runs and strips the ends", () => {
    expect(normalizeText(["", "  hello  ", "", "", "", "world ", ""])).toBe("hello\n\nworld");
    expect(normalizeText(["a\r\nb"])).toBe("a\nb");
    expect(normalizeText([])).toBe("");
    expect(normalizeText(["", " ", ""])).toBe("");
  });
});

describe("bad files give clear errors", () => {
  const sample = fs.readFileSync(SAMPLE);
  const message = (data: Uint8Array) => {
    try {
      parsePptx(data);
    } catch (err) {
      expect(err).toBeInstanceOf(PptxError); // never a raw crash
      return (err as Error).message;
    }
    throw new Error("expected parsePptx to throw");
  };

  it("rejects an empty file", () => expect(message(new Uint8Array())).toMatch(/empty/));

  it("rejects a file that isn't a zip", () => {
    expect(message(strToU8("this is just a text file"))).toMatch(/isn't a PowerPoint/);
    expect(message(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toMatch(/isn't a PowerPoint/); // a PDF
  });

  it("explains old .ppt and password-protected files", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(message(ole)).toMatch(/old-format \.ppt.*password-protected/);
  });

  it("rejects a zip that isn't a presentation (e.g. a Word file)", () => {
    const docx = zipSync({ "word/document.xml": strToU8("<w:document/>"), "[Content_Types].xml": strToU8("<Types/>") });
    expect(message(docx)).toMatch(/not a PowerPoint presentation/);
  });

  it("rejects a truncated file", () => {
    expect(message(sample.subarray(0, Math.floor(sample.length * 0.6)))).toMatch(/corrupted|can't be opened/);
  });

  it("rejects corrupt XML in a slide", () => {
    const broken = buildPptx({ slides: [{ shapes: [{ paragraphs: ["ok"] }] }], parts: { "ppt/slides/slide1.xml": "<p:sld><p:cSld><p:spTree><p:sp></p:cSld>" } });
    expect(message(broken)).toMatch(/Slide 1 is damaged/);
  });

  it("rejects corrupt XML in the slide list", () => {
    const broken = buildPptx({ slides: [{}], parts: { "ppt/presentation.xml": "<p:presentation><p:sldIdLst>" } });
    expect(message(broken)).toMatch(/slide list is damaged/);
  });

  it("rejects a presentation that points at a missing slide", () => {
    expect(message(buildPptx({ slides: [{}, {}], omit: ["ppt/slides/slide2.xml"] }))).toMatch(/Slide 2 is missing/);
  });

  it("rejects a slide id with no matching relationship", () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    expect(message(buildPptx({ slides: [{}], parts: { "ppt/_rels/presentation.xml.rels": rels } }))).toMatch(/slide list in this file is damaged/);
  });

  it("rejects a presentation with no slides", () => {
    expect(message(buildPptx({ slides: [] }))).toMatch(/No slides were found/);
  });

  it("refuses presentations with too many slides", () => {
    const many = buildPptx({ slides: Array.from({ length: LIMITS.maxSlides + 1 }, () => ({ shapes: [{ paragraphs: ["x"] }] })) });
    expect(message(many)).toMatch(/limit for import is 500/);
  });
});

describe("decompression limits (zip bombs)", () => {
  const saved = { ...LIMITS };
  afterEach(() => Object.assign(LIMITS, saved));

  it("refuses a part that expands too far", () => {
    LIMITS.maxEntryBytes = 2000;
    const big = buildPptx({ slides: [{ shapes: [{ paragraphs: ["x".repeat(5000)] }] }] });
    expect(() => parsePptx(big)).toThrow(/far too large/);
  });

  it("refuses a package whose total expanded size is too large", () => {
    LIMITS.maxTotalBytes = 1500;
    const deck = buildPptx({ slides: Array.from({ length: 4 }, () => ({ shapes: [{ paragraphs: ["some lyrics"] }] })) });
    expect(() => parsePptx(deck)).toThrow(/unreasonable size/);
  });

  it("ignores huge parts that aren't slides, notes or the slide list", () => {
    LIMITS.maxEntryBytes = 2000;
    const deck = buildPptx({ slides: [{ shapes: [{ paragraphs: ["fine"] }] }], parts: { "ppt/media/image1.png": "x".repeat(50_000) } });
    expect(parsePptx(deck)[0]!.lyrics).toBe("fine"); // the picture is never even inflated
  });
});
