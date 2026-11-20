import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "../shared/types.js";
import { makeTestApp } from "./helpers.js";

/** Smallest byte patterns that pass the server's "is this really a video?" check. */
const fakeMp4 = (extra = 100) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(extra)]);
const fakeWebm = (extra = 100) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8 + extra)]);

describe("video upload and serving", () => {
  it("uploads, lists, streams (with Range), renames and deletes a video", async () => {
    const { app, config } = makeTestApp();
    const up = await request(app).post("/api/videos").attach("file", fakeMp4(5000), "Sunrise Loop.mp4");
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: "Sunrise Loop", mime: "video/mp4", url: `/media/${up.body.id}` });
    expect(up.body.filename).toBeUndefined(); // on-disk name stays private
    const id = up.body.id as number;

    const list = await request(app).get("/api/videos");
    expect(list.body.videos).toHaveLength(1);
    expect(list.body.maxUploadMb).toBe(500);

    const full = await request(app).get(`/media/${id}`);
    expect(full.status).toBe(200);
    expect(full.headers["content-type"]).toContain("video/mp4");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cache-control"]).toContain("immutable");

    const part = await request(app).get(`/media/${id}`).set("Range", "bytes=0-99");
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toMatch(/^bytes 0-99\//);

    const renamed = await request(app).patch(`/api/videos/${id}`).send({ name: "Dawn" });
    expect(renamed.body.name).toBe("Dawn");

    expect((await request(app).delete(`/api/videos/${id}`)).status).toBe(204);
    expect((await request(app).get(`/media/${id}`)).status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readdirSync(config.videosDir)).toEqual([]); // the file is gone from disk too
  });

  it("accepts webm", async () => {
    const { app } = makeTestApp();
    const up = await request(app).post("/api/videos").attach("file", fakeWebm(), "loop.webm");
    expect(up.status).toBe(201);
    expect(up.body.mime).toBe("video/webm");
  });

  it("rejects wrong file types and files whose contents aren't video", async () => {
    const { app, config } = makeTestApp();
    const wrongExt = await request(app).post("/api/videos").attach("file", fakeMp4(), "notes.txt");
    expect(wrongExt.status).toBe(400);
    expect(wrongExt.body.error).toMatch(/mp4 and \.webm/);

    const disguised = await request(app).post("/api/videos").attach("file", Buffer.from("just some text, not a video at all"), "fake.mp4");
    expect(disguised.status).toBe(400);
    expect(disguised.body.error).toMatch(/isn't a valid/);

    const noFile = await request(app).post("/api/videos").field("x", "y");
    expect(noFile.status).toBe(400);
    const notMultipart = await request(app).post("/api/videos").send({ a: 1 });
    expect(notMultipart.status).toBe(400);

    expect(fs.readdirSync(config.videosDir)).toEqual([]); // nothing half-written is left behind
    expect((await request(app).get("/api/videos")).body.videos).toHaveLength(0);
  });

  it("enforces the size limit with a clear message", async () => {
    const { app, config } = makeTestApp({ maxVideoMb: 0.01 }); // ~10 KB
    const big = await request(app).post("/api/videos").attach("file", fakeMp4(50_000), "big.mp4");
    expect(big.status).toBe(413);
    expect(big.body.error).toBe("That video is larger than the 0.01 MB limit.");
    expect(fs.readdirSync(config.videosDir)).toEqual([]);

    const small = await request(app).post("/api/videos").attach("file", fakeMp4(100), "small.mp4");
    expect(small.status).toBe(201);
  });

  it("requires the password for management but keeps /media open for the displays", async () => {
    const { app } = makeTestApp({ appPassword: "secret" });
    expect((await request(app).post("/api/videos").attach("file", fakeMp4(), "a.mp4")).status).toBe(401);
    expect((await request(app).get("/api/videos")).status).toBe(401);
    expect((await request(app).delete("/api/videos/1")).status).toBe(401);
    expect((await request(app).get("/media/1")).status).toBe(404); // open route, just no such video
  });

  it("clears the video from presentations when it is deleted", async () => {
    const { app, repo, live } = makeTestApp();
    const video = (await request(app).post("/api/videos").attach("file", fakeMp4(), "bg.mp4")).body;
    const p = repo.createPresentation("Song");
    repo.addSlide(p.id, "A");
    await request(app).put(`/api/presentations/${p.id}/settings`).send({ main: { videoId: video.id } });
    live.command({ type: "show", presentationId: p.id });
    expect(live.getDisplay().videoUrl).toBe(`/media/${video.id}`);

    await request(app).delete(`/api/videos/${video.id}`);
    expect(repo.getSettings(p.id)?.main.videoId).toBeNull();
    expect(live.getDisplay().videoUrl).toBeNull();
  });

  it("leaves path traversal out of reach", async () => {
    const { app, config } = makeTestApp();
    fs.writeFileSync(path.join(config.dataDir, "secret.txt"), "private");
    expect((await request(app).get("/media/..%2Fsecret.txt")).status).toBe(404);
  });
});

describe("settings", () => {
  it("merges partial updates and corrects invalid values", async () => {
    const { app, repo } = makeTestApp();
    const p = repo.createPresentation("Song");
    const res = await request(app)
      .put(`/api/presentations/${p.id}/settings`)
      .send({ main: { fontSize: 999, color: "not-a-color", align: "right" }, singers: { backgroundColor: "#112233" } });
    expect(res.status).toBe(200);
    expect(res.body.main.fontSize).toBe(25); // clamped
    expect(res.body.main.color).toBe(DEFAULT_SETTINGS.main.color); // invalid -> default
    expect(res.body.main.align).toBe("right");
    expect(res.body.singers.backgroundColor).toBe("#112233");
    expect(res.body.main.shadow).toBe(DEFAULT_SETTINGS.main.shadow); // untouched fields keep their value

    const detail = await request(app).get(`/api/presentations/${p.id}`);
    expect(detail.body.settings.main.align).toBe("right");
    expect((await request(app).put("/api/presentations/999/settings").send({})).status).toBe(404);
  });

  it("duplicating a presentation copies its settings", async () => {
    const { app, repo } = makeTestApp();
    const p = repo.createPresentation("Song");
    await request(app).put(`/api/presentations/${p.id}/settings`).send({ main: { fontSize: 11 } });
    const copy = (await request(app).post(`/api/presentations/${p.id}/duplicate`)).body;
    expect(repo.getSettings(copy.id)?.main.fontSize).toBe(11);
  });

  it("normalizeSettings tolerates garbage", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ main: { videoId: -3, font: "comic-sans", vertical: -50 } }).main).toMatchObject({
      videoId: null,
      font: "sans",
      vertical: 0,
    });
    expect(mergeSettings(DEFAULT_SETTINGS, { main: { shadow: 2 } }).main.shadow).toBe(2);
  });
});
