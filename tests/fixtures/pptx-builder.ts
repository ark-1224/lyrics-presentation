import { strToU8, zipSync } from "fflate";

/**
 * Builds small but structurally realistic .pptx packages for tests (the same parts PowerPoint
 * writes: content types, relationships, presentation.xml with the slide list, slides, notes pages).
 * It is NOT a full PowerPoint file (no theme/master), so it is meant for our parser, not for PowerPoint.
 */

export type ShapeKind = "title" | "subTitle" | "body" | "textbox" | "sldNum" | "dt" | "ftr";

export interface Shape {
  kind?: ShapeKind; // default "textbox"
  /** One entry per paragraph; "\n" inside an entry becomes a soft line break (<a:br/>). */
  paragraphs?: string[];
}

export interface SlideSpec {
  shapes?: Shape[];
  /** Speaker notes, one entry per paragraph. */
  notes?: string[];
  /** Also put a slide-number placeholder on the notes page (PowerPoint always does). */
  notesSlideNumber?: boolean;
  hidden?: boolean;
  /** Add a picture with alt text (which must never be imported as lyrics). */
  picture?: boolean;
  /** Extra raw XML placed inside the slide's shape tree (tables, groups, AlternateContent...). */
  extraXml?: string;
}

export interface DeckOptions {
  slides: SlideSpec[];
  /** Store slide k (in show order) as slide{N-k}.xml, so file names don't match the show order. */
  reverseFileNames?: boolean;
  /** Write relationship targets as absolute paths ("/ppt/slides/slide1.xml"), as some exporters do. */
  absoluteTargets?: boolean;
  /** Replace or add raw parts by zip path (e.g. to inject corrupt XML). */
  parts?: Record<string, string>;
  /** Leave these parts out of the zip. */
  omit?: string[];
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A paragraph: text split at "\n" into runs separated by line breaks. */
function paragraph(text: string): string {
  if (text === "") return '<a:p><a:endParaRPr lang="en-US"/></a:p>'; // an empty paragraph
  const runs = text
    .split("\n")
    .map((line) => `<a:r><a:rPr lang="en-US"/><a:t>${esc(line)}</a:t></a:r>`)
    .join("<a:br><a:rPr lang=\"en-US\"/></a:br>");
  return `<a:p>${runs}</a:p>`;
}

const PLACEHOLDER: Record<ShapeKind, string> = {
  title: '<p:ph type="title"/>',
  subTitle: '<p:ph type="subTitle" idx="1"/>',
  body: '<p:ph idx="1"/>', // no type attribute = a normal content placeholder
  textbox: "",
  sldNum: '<p:ph type="sldNum" sz="quarter" idx="12"/>',
  dt: '<p:ph type="dt" sz="half" idx="10"/>',
  ftr: '<p:ph type="ftr" sz="quarter" idx="11"/>',
};

function shapeXml(shape: Shape, id: number): string {
  const kind = shape.kind ?? "textbox";
  let body: string;
  if (kind === "sldNum") body = '<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p>';
  else if (kind === "dt") body = '<a:p><a:fld id="{C1D2E3F4-0000-4000-8000-000000000001}" type="datetime1"><a:rPr lang="en-US"/><a:t>11/21/2026</a:t></a:fld></a:p>';
  else body = (shape.paragraphs ?? []).map(paragraph).join("");
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${PLACEHOLDER[kind]}</p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`
  );
}

const PICTURE =
  '<p:pic><p:nvPicPr><p:cNvPr id="90" name="Picture 89" descr="ALT-TEXT-MUST-BE-IGNORED"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr/></p:pic>';

function slideXml(spec: SlideSpec): string {
  const shapes = (spec.shapes ?? []).map((s, i) => shapeXml(s, i + 2)).join("");
  return (
    `${HEADER}<p:sld ${NS}${spec.hidden ? ' show="0"' : ""}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    `${shapes}${spec.picture ? PICTURE : ""}${spec.extraXml ?? ""}` +
    "</p:spTree></p:cSld></p:sld>"
  );
}

function notesXml(spec: SlideSpec): string {
  const thumbnail =
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>';
  const body = shapeXml({ kind: "body", paragraphs: spec.notes ?? [] }, 3).replace('<p:ph idx="1"/>', '<p:ph type="body" idx="1"/>');
  const number = spec.notesSlideNumber ? shapeXml({ kind: "sldNum" }, 4) : "";
  return (
    `${HEADER}<p:notes ${NS}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    `${thumbnail}${body}${number}</p:spTree></p:cSld></p:notes>`
  );
}

const rels = (items: { id: string; type: string; target: string }[]) =>
  `${HEADER}<Relationships xmlns="${REL_NS}">` +
  items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join("") +
  "</Relationships>";

export function buildPptx(opts: DeckOptions): Uint8Array {
  const n = opts.slides.length;
  const files: Record<string, string> = {};
  const target = (zipPath: string, relative: string) => (opts.absoluteTargets ? `/${zipPath}` : relative);

  files["[Content_Types].xml"] =
    `${HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    "</Types>";
  files["_rels/.rels"] = rels([{ id: "rId1", type: `${REL_TYPE}/officeDocument`, target: "ppt/presentation.xml" }]);

  const presentationRels: { id: string; type: string; target: string }[] = [];
  const slideIds: string[] = [];
  opts.slides.forEach((spec, k) => {
    // Show position k is stored under a file number that may differ from k.
    const fileNo = opts.reverseFileNames ? n - k : k + 1;
    const slidePart = `ppt/slides/slide${fileNo}.xml`;
    files[slidePart] = slideXml(spec);
    presentationRels.push({ id: `rId${k + 10}`, type: `${REL_TYPE}/slide`, target: target(slidePart, `slides/slide${fileNo}.xml`) });
    slideIds.push(`<p:sldId id="${256 + k}" r:id="rId${k + 10}"/>`); // listed in show order

    const slideRels: { id: string; type: string; target: string }[] = [
      { id: "rId1", type: `${REL_TYPE}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
    ];
    if (spec.notes) {
      const notesPart = `ppt/notesSlides/notesSlide${fileNo}.xml`;
      files[notesPart] = notesXml(spec);
      files[`ppt/notesSlides/_rels/notesSlide${fileNo}.xml.rels`] = rels([
        { id: "rId1", type: `${REL_TYPE}/slide`, target: `../slides/slide${fileNo}.xml` },
      ]);
      slideRels.push({ id: "rId2", type: `${REL_TYPE}/notesSlide`, target: target(notesPart, `../notesSlides/notesSlide${fileNo}.xml`) });
    }
    files[`ppt/slides/_rels/slide${fileNo}.xml.rels`] = rels(slideRels);
  });

  files["ppt/_rels/presentation.xml.rels"] = rels(presentationRels);
  files["ppt/presentation.xml"] = `${HEADER}<p:presentation ${NS}><p:sldIdLst>${slideIds.join("")}</p:sldIdLst></p:presentation>`;

  Object.assign(files, opts.parts);
  for (const name of opts.omit ?? []) delete files[name];

  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}
