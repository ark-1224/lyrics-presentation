import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { Router } from "express";
import type { Request, Response } from "express";
import type { Video } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Repo, VideoRecord } from "../repo.js";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm" };
const MAX_NAME = 100;

/** Public view of a video (the on-disk filename stays private). */
const publicVideo = (v: VideoRecord): Video => ({ id: v.id, name: v.name, size: v.size, mime: v.mime, url: v.url, createdAt: v.createdAt });

class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Check the real file contents, not just the name: MP4 has "ftyp" at byte 4, WebM starts with the EBML magic. */
function looksLikeVideo(file: string, ext: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    const read = fs.readSync(fd, head, 0, 12, 0);
    if (read < 12) return false;
    if (ext === ".mp4") return head.toString("latin1", 4, 8) === "ftyp";
    return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Stream one uploaded file to disk without buffering it in memory.
 * Writes to a ".part" file first and only renames it to its final name once it passed all checks,
 * so a half-finished or rejected upload never shows up as a video.
 */
function receiveUpload(req: Request, config: Config): Promise<{ name: string; filename: string; mime: string; size: number }> {
  // Must be a whole number: busboy only notices the limit when the byte count equals it exactly,
  // so a fractional MAX_VIDEO_MB (e.g. 1.5) would otherwise silently disable the size cap.
  const maxBytes = Math.floor(config.maxVideoMb * 1024 * 1024);
  return new Promise((resolve, reject) => {
    let handled = false;
    const fail = (e: UploadError) => {
      if (!handled) {
        handled = true;
        reject(e);
      }
    };
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fields: 0, fileSize: maxBytes } });
    } catch {
      return reject(new UploadError("Send the video as a file upload (multipart form).", 400));
    }

    let gotFile = false;
    bb.on("file", (_field, stream, info) => {
      if (handled) return void stream.resume();
      gotFile = true;
      const original = info.filename ?? "";
      const ext = path.extname(original).toLowerCase();
      if (!TYPES[ext]) {
        stream.resume();
        return fail(new UploadError("Only .mp4 and .webm videos are supported.", 400));
      }
      const filename = `${randomUUID()}${ext}`;
      const partial = path.join(config.videosDir, `${filename}.part`);
      let truncated = false;
      stream.on("limit", () => (truncated = true));

      pipeline(stream, fs.createWriteStream(partial))
        .then(() => {
          // Second guard: also compare the real size on disk, in case the limit event was missed.
          if (truncated || fs.statSync(partial).size >= maxBytes) throw new UploadError(`That video is larger than the ${config.maxVideoMb} MB limit.`, 413);
          if (!looksLikeVideo(partial, ext)) throw new UploadError("That file isn't a valid .mp4 or .webm video.", 400);
          fs.renameSync(partial, path.join(config.videosDir, filename));
          const size = fs.statSync(path.join(config.videosDir, filename)).size;
          const name = path.basename(original, ext).trim().slice(0, MAX_NAME) || "Video";
          if (!handled) {
            handled = true;
            resolve({ name, filename, mime: TYPES[ext]!, size });
          }
        })
        .catch((err: unknown) => {
          // Remove the partial file first, then answer, so nothing half-written is ever left behind.
          fs.rm(partial, { force: true }, () =>
            fail(err instanceof UploadError ? err : new UploadError("Upload failed. Please try again.", 500)),
          );
        });
    });
    bb.on("error", () => fail(new UploadError("Upload failed. Please try again.", 400)));
    bb.on("close", () => {
      if (!gotFile) fail(new UploadError("No video file was received.", 400));
    });
    req.on("close", () => {
      if (!req.complete) fail(new UploadError("Upload cancelled.", 400)); // browser tab closed / network dropped
    });
    req.pipe(bb);
  });
}

export function videoRoutes(repo: Repo, config: Config, onChange: () => void): Router {
  const r = Router();

  r.get("/videos", (_req, res) => {
    const usage = repo.videoUsage();
    res.json({
      videos: repo.listVideos().map((v) => ({ ...publicVideo(v), usedBy: usage.get(v.id) ?? 0 })),
      maxUploadMb: config.maxVideoMb,
    });
  });

  r.post("/videos", async (req: Request, res: Response) => {
    try {
      const upload = await receiveUpload(req, config);
      const video = repo.addVideo(upload);
      res.status(201).json(publicVideo(video));
    } catch (err) {
      const e = err instanceof UploadError ? err : new UploadError("Upload failed.", 500);
      res.status(e.status).json({ error: e.message });
    }
  });

  r.patch("/videos/:id", (req, res) => {
    const id = Number(req.params.id);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > MAX_NAME) return void res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters)` });
    const v = Number.isInteger(id) && repo.renameVideo(id, name);
    if (!v) return void res.status(404).json({ error: "Video not found" });
    res.json(publicVideo(v));
  });

  r.delete("/videos/:id", (req, res) => {
    const id = Number(req.params.id);
    const v = Number.isInteger(id) ? repo.deleteVideo(id) : undefined;
    if (!v) return void res.status(404).json({ error: "Video not found" });
    fs.rm(path.join(config.videosDir, v.filename), { force: true }, () => {});
    onChange(); // displays using it fade back to no video
    res.status(204).end();
  });

  return r;
}

/**
 * Public video file route (/media/:id). It is open on purpose: the display windows need it,
 * and the ids are not guessable secrets worth protecting (they are just lyrics backgrounds).
 * sendFile handles HTTP Range requests, which browsers need for smooth looping playback.
 */
export function mediaRoute(repo: Repo, config: Config): Router {
  const r = Router();
  r.get("/media/:id", (req, res) => {
    const id = Number(req.params.id);
    const v = Number.isInteger(id) ? repo.getVideo(id) : undefined;
    if (!v) return void res.status(404).end();
    res.type(v.mime);
    // Ids are never reused and file contents never change, so browsers may cache for a long time.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(v.filename, { root: config.videosDir }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
  return r;
}
