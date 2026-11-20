import path from "node:path";
import busboy from "busboy";
import { Router } from "express";
import type { Request } from "express";
import type { ImportRequest, PptxPreview } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Repo } from "../repo.js";
import { PptxError, parsePptx } from "../pptx/parser.js";
import { MAX_NAME, MAX_TEXT, cleanName } from "./presentations.js";

const MAX_IMPORT_SLIDES = 1000;

class ImportUploadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Read one uploaded .pptx into memory (it is parsed in memory and never written to disk). */
function receivePptx(req: Request, maxBytes: number, maxMb: number): Promise<{ filename: string; data: Buffer }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: ImportUploadError) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    let bb: ReturnType<typeof busboy>;
    try {
      // Whole number on purpose: busboy only notices its limit when the byte count equals it exactly.
      bb = busboy({ headers: req.headers, limits: { files: 1, fields: 0, fileSize: Math.floor(maxBytes) } });
    } catch {
      return reject(new ImportUploadError("Send the presentation as a file upload (multipart form).", 400));
    }
    let gotFile = false;
    bb.on("file", (_field, stream, info) => {
      if (settled) return void stream.resume();
      gotFile = true;
      const filename = info.filename ?? "";
      const ext = path.extname(filename).toLowerCase();
      if (ext !== ".pptx") {
        stream.resume();
        return fail(
          new ImportUploadError(
            ext === ".ppt"
              ? "Old .ppt files can't be imported. Open it in PowerPoint and use Save As → PowerPoint Presentation (.pptx)."
              : "Please choose a PowerPoint .pptx file.",
            400,
          ),
        );
      }
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("limit", () => (truncated = true));
      stream.on("error", () => fail(new ImportUploadError("Upload failed. Please try again.", 400)));
      stream.on("end", () => {
        if (truncated) return fail(new ImportUploadError(`That file is larger than the ${maxMb} MB limit for importing.`, 413));
        if (!settled) {
          settled = true;
          resolve({ filename, data: Buffer.concat(chunks) });
        }
      });
    });
    bb.on("error", () => fail(new ImportUploadError("Upload failed. Please try again.", 400)));
    bb.on("close", () => {
      if (!gotFile) fail(new ImportUploadError("No file was received.", 400));
    });
    req.on("close", () => {
      if (!req.complete) fail(new ImportUploadError("Upload cancelled.", 400));
    });
    req.pipe(bb);
  });
}

/**
 * PowerPoint import is two steps so the operator can check the result before anything is saved:
 *   POST /api/import/pptx  -> parses the file and returns a preview (nothing is stored)
 *   POST /api/import       -> creates the presentation from the (possibly edited) preview
 */
export function importRoutes(repo: Repo, config: Config): Router {
  const r = Router();

  r.post("/import/pptx", async (req, res) => {
    try {
      const { filename, data } = await receivePptx(req, config.maxPptxMb * 1024 * 1024, config.maxPptxMb);
      const slides = parsePptx(data);
      const preview: PptxPreview = {
        fileName: filename,
        suggestedName: path.basename(filename, path.extname(filename)).trim().slice(0, MAX_NAME) || "Imported presentation",
        slides,
      };
      res.json(preview);
    } catch (err) {
      if (err instanceof ImportUploadError) return void res.status(err.status).json({ error: err.message });
      if (err instanceof PptxError) return void res.status(422).json({ error: err.message });
      console.error("PPTX import failed unexpectedly:", err);
      res.status(422).json({ error: "That file couldn't be read as a PowerPoint presentation." });
    }
  });

  r.post("/import", (req, res) => {
    const body = req.body as Partial<ImportRequest> | undefined;
    const name = cleanName(body?.name);
    if (!name) return void res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters)` });
    const slides = body?.slides;
    if (!Array.isArray(slides) || slides.length === 0) return void res.status(400).json({ error: "Choose at least one slide to import." });
    if (slides.length > MAX_IMPORT_SLIDES) return void res.status(400).json({ error: `Too many slides (max ${MAX_IMPORT_SLIDES}).` });
    const valid = slides.every(
      (s) => typeof s?.lyrics === "string" && typeof s?.notes === "string" && s.lyrics.length <= MAX_TEXT && s.notes.length <= MAX_TEXT,
    );
    if (!valid) return void res.status(400).json({ error: `Each slide's lyrics and notes must be text of at most ${MAX_TEXT} characters.` });
    res.status(201).json(repo.importPresentation(name, slides));
  });

  return r;
}
