import path from "node:path";
import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Reads the text and speaker notes out of a .pptx file. Nothing else (images, shapes, colours,
 * fonts, animations) is looked at.
 *
 * A .pptx is a zip of XML files:
 *   ppt/presentation.xml            lists the slides IN SHOW ORDER (ids that point into the rels file)
 *   ppt/_rels/presentation.xml.rels maps those ids to files such as slides/slide3.xml
 *   ppt/slides/slideN.xml           the slide: shapes -> text frames -> paragraphs -> runs of text
 *   ppt/slides/_rels/slideN.xml.rels  points to the slide's notes page, if it has one
 *   ppt/notesSlides/notesSlideN.xml the speaker notes
 * The file names do NOT have to match the show order, so the order is always taken from
 * presentation.xml. Every error thrown here is a PptxError with a message safe to show the operator.
 */

export class PptxError extends Error {}

export interface ParsedSlide {
  number: number; // 1-based position in the show
  lyrics: string;
  notes: string;
  empty: boolean;
  hidden: boolean;
}

/** Guards against absurd or malicious files (a tiny zip can expand to gigabytes). */
export const LIMITS = {
  maxSlides: 500,
  maxEntryBytes: 10 * 1024 * 1024, // one XML part, uncompressed
  maxTotalBytes: 100 * 1024 * 1024, // everything we extract, uncompressed
};

// Placeholders whose text is page furniture, not lyrics: slide number, date, footer, header, thumbnail.
const FURNITURE = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);

// ---- tiny helpers over fast-xml-parser's "preserveOrder" output ------------------------------
// Every element is { "ns:tag": [children...], ":@": { "@_attr": "value" } }; text is { "#text": "..." }.

type XNode = { [key: string]: unknown };

const xml = new XMLParser({
  preserveOrder: true, // keeps runs, line breaks and fields in the order they appear
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false, // keep the spaces inside runs ("Amazing " + "grace")
  parseTagValue: false, // keep "1984" as text, not a number
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

const tagOf = (n: XNode): string | undefined => Object.keys(n).find((k) => k !== ":@");
const localName = (tag: string) => tag.slice(tag.indexOf(":") + 1); // "a:p" -> "p"
const kids = (n: XNode): XNode[] => {
  const t = tagOf(n);
  const v = t ? n[t] : undefined;
  return Array.isArray(v) ? (v as XNode[]) : [];
};
const attrs = (n: XNode): Record<string, string> => (n[":@"] as Record<string, string> | undefined) ?? {};
const attr = (n: XNode, name: string): string | undefined => attrs(n)[`@_${name}`];
/** The relationship id attribute, written r:id (the prefix is nearly always "r", but accept any). */
const relId = (n: XNode): string | undefined =>
  Object.entries(attrs(n)).find(([k]) => k.startsWith("@_") && k.endsWith(":id"))?.[1];

function descendants(nodes: XNode[], name: string, out: XNode[] = []): XNode[] {
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t) continue;
    if (localName(t) === name) out.push(n);
    descendants(kids(n), name, out);
  }
  return out;
}

function parseXml(text: string, what: string): XNode[] {
  // The parser is forgiving; validating first is what actually catches truncated/corrupt XML.
  if (XMLValidator.validate(text) !== true) throw new PptxError(`${what} is damaged, so this file can't be read.`);
  return xml.parse(text) as XNode[];
}

// ---- text extraction ---------------------------------------------------------------------------

/** Text inside one <a:t> element. */
function textOf(n: XNode): string {
  return kids(n)
    .map((c) => (typeof c["#text"] === "string" ? c["#text"] : ""))
    .join("");
}

/** One paragraph (<a:p>): runs of text, line breaks and fields, in order. */
function paragraphText(p: XNode): string {
  let out = "";
  for (const c of kids(p)) {
    const t = tagOf(c);
    if (!t) continue;
    switch (localName(t)) {
      case "r": // a run of text
        out += kids(c)
          .filter((x) => tagOf(x) && localName(tagOf(x)!) === "t")
          .map(textOf)
          .join("");
        break;
      case "br": // a soft line break (Shift+Enter)
        out += "\n";
        break;
      case "fld": // a field: keep real text, drop auto-numbers and dates
        if (!/^(slidenum|datetime)/i.test(attr(c, "type") ?? "")) {
          out += kids(c)
            .filter((x) => tagOf(x) && localName(tagOf(x)!) === "t")
            .map(textOf)
            .join("");
        }
        break;
    }
  }
  return out.replaceAll("\u000b", "\n"); // vertical tab is how some producers write a line break
}

/** Placeholder type of a shape ("title", "body", "sldNum"...), or undefined for an ordinary text box. */
function placeholderType(sp: XNode): string | undefined {
  const ph = descendants(kids(sp), "ph")[0];
  return ph ? (attr(ph, "type") ?? "body") : undefined;
}

/** Walk a slide (or notes page) in document order and collect every paragraph worth keeping. */
function collectParagraphs(nodes: XNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t) continue;
    const name = localName(t);
    if (name === "sp") {
      const type = placeholderType(n);
      if (type && FURNITURE.has(type)) continue; // skip the whole shape
      collectParagraphs(kids(n), out);
    } else if (name === "p") {
      out.push(paragraphText(n));
    } else if (name === "AlternateContent") {
      // Newer features come with a fallback copy of the same content: use only one of them.
      const choice = kids(n).find((c) => tagOf(c) && localName(tagOf(c)!) === "Choice");
      if (choice) collectParagraphs(kids(choice), out);
    } else {
      collectParagraphs(kids(n), out); // groups, tables, text bodies...
    }
  }
  return out;
}

/** Trim each line, collapse runs of blank lines to one, and strip blank lines at both ends. */
export function normalizeText(paragraphs: string[]): string {
  const lines = paragraphs
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim()); // trim() also strips non-breaking spaces and tabs
  const kept: string[] = [];
  for (const line of lines) {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

// ---- zip + relationships -----------------------------------------------------------------------

function unzip(data: Uint8Array, wanted: Set<string>, budget: { total: number }): Record<string, Uint8Array> {
  try {
    return unzipSync(data, {
      filter(file) {
        if (!wanted.has(file.name)) return false;
        // originalSize comes from the zip's index; fflate also refuses to inflate past it.
        if (file.originalSize > LIMITS.maxEntryBytes) {
          throw new PptxError("This file contains a part that is far too large to be a normal presentation.");
        }
        budget.total += file.originalSize;
        if (budget.total > LIMITS.maxTotalBytes) {
          throw new PptxError("This presentation expands to an unreasonable size, so it can't be imported.");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof PptxError) throw err;
    throw new PptxError("That file can't be opened. It may be corrupted or not a real .pptx file.");
  }
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

interface Rel {
  id: string;
  type: string;
  target: string;
}

function parseRels(text: string, what: string): Rel[] {
  return descendants(parseXml(text, what), "Relationship").map((n) => ({
    id: attr(n, "Id") ?? "",
    type: attr(n, "Type") ?? "",
    target: attr(n, "Target") ?? "",
  }));
}

/** Turn a relationship target into a zip entry name. `baseDir` is the folder of the part that owns the rels. */
function resolveTarget(baseDir: string, target: string): string | undefined {
  const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`${baseDir}/${target}`);
  return resolved.startsWith("..") || resolved === "" ? undefined : resolved;
}

const relsPathFor = (part: string) => `${path.posix.dirname(part)}/_rels/${path.posix.basename(part)}.rels`;

// ---- main entry point --------------------------------------------------------------------------

export function parsePptx(data: Uint8Array): ParsedSlide[] {
  if (data.length === 0) throw new PptxError("That file is empty.");
  // Old binary PowerPoint (.ppt) and password-protected .pptx files are OLE containers, not zips.
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) {
    throw new PptxError(
      "This is an old-format .ppt file or a password-protected presentation. Open it in PowerPoint, remove any password, and use Save As → PowerPoint Presentation (.pptx).",
    );
  }
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new PptxError("That file isn't a PowerPoint (.pptx) file. It is not a zip package.");
  }

  const budget = { total: 0 };
  // Pass 1: the slide list and where each slide lives.
  const core = unzip(data, new Set(["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]), budget);
  const presentationXml = core["ppt/presentation.xml"];
  const presentationRels = core["ppt/_rels/presentation.xml.rels"];
  if (!presentationXml || !presentationRels) {
    throw new PptxError("That file is a zip, but not a PowerPoint presentation (it may be a Word or Excel file).");
  }

  const rels = new Map(parseRels(decode(presentationRels), "The slide list").map((r) => [r.id, r]));
  const slideIds = descendants(parseXml(decode(presentationXml), "The slide list"), "sldId");
  const slideParts: string[] = [];
  for (const id of slideIds) {
    const rel = rels.get(relId(id) ?? "");
    const part = rel && resolveTarget("ppt", rel.target);
    if (!part) throw new PptxError("The slide list in this file is damaged, so it can't be read.");
    slideParts.push(part);
  }
  if (slideParts.length === 0) throw new PptxError("No slides were found in this file.");
  if (slideParts.length > LIMITS.maxSlides) {
    throw new PptxError(`This presentation has ${slideParts.length} slides; the limit for import is ${LIMITS.maxSlides}.`);
  }

  // Pass 2: the slides and their relationship files (to find the notes pages).
  const wanted = new Set(slideParts.flatMap((p) => [p, relsPathFor(p)]));
  const slideFiles = unzip(data, wanted, budget);

  // Pass 3: the notes pages that those slides point to.
  const notesPartFor = new Map<string, string>();
  for (const part of slideParts) {
    const relsFile = slideFiles[relsPathFor(part)];
    if (!relsFile) continue;
    const notesRel = parseRels(decode(relsFile), "A slide's links").find((r) => r.type.endsWith("/notesSlide"));
    const notesPart = notesRel && resolveTarget(path.posix.dirname(part), notesRel.target);
    if (notesPart) notesPartFor.set(part, notesPart);
  }
  const notesFiles = unzip(data, new Set(notesPartFor.values()), budget);

  return slideParts.map((part, i) => {
    const number = i + 1;
    const slideXml = slideFiles[part];
    if (!slideXml) throw new PptxError(`Slide ${number} is missing from the file, so it may be damaged.`);
    const tree = parseXml(decode(slideXml), `Slide ${number}`);
    const root = tree.find((n) => tagOf(n) && localName(tagOf(n)!) === "sld");
    const lyrics = normalizeText(collectParagraphs(tree));

    let notes = "";
    const notesPart = notesPartFor.get(part);
    const notesXml = notesPart ? notesFiles[notesPart] : undefined;
    if (notesXml) notes = normalizeText(collectParagraphs(parseXml(decode(notesXml), `The notes of slide ${number}`)));

    return { number, lyrics, notes, empty: lyrics === "", hidden: root ? attr(root, "show") === "0" : false };
  });
}
