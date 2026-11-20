import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers.js";

function makeApp(appPassword?: string) {
  return makeTestApp({ appPassword }).app;
}

describe("presentations API", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("creates, lists, renames and deletes a presentation", async () => {
    const created = await request(app).post("/api/presentations").send({ name: "  Sunday Worship " });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Sunday Worship"); // trimmed

    const list = await request(app).get("/api/presentations");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].slideCount).toBe(0);

    const renamed = await request(app).patch(`/api/presentations/${created.body.id}`).send({ name: "Easter" });
    expect(renamed.body.name).toBe("Easter");

    expect((await request(app).delete(`/api/presentations/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/presentations/${created.body.id}`)).status).toBe(404);
  });

  it("rejects empty or missing names", async () => {
    expect((await request(app).post("/api/presentations").send({ name: "   " })).status).toBe(400);
    expect((await request(app).post("/api/presentations").send({})).status).toBe(400);
  });

  it("adds, edits and deletes slides, keeping positions contiguous", async () => {
    const p = (await request(app).post("/api/presentations").send({ name: "Song" })).body;
    const a = (await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "A", notes: "n" })).body;
    const b = (await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "B" })).body;
    const c = (await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "C" })).body;
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    const edited = await request(app).patch(`/api/slides/${b.id}`).send({ lyrics: "B2\nsecond line" });
    expect(edited.body.lyrics).toBe("B2\nsecond line");
    expect(edited.body.notes).toBe(""); // untouched fields stay as they were

    await request(app).delete(`/api/slides/${a.id}`);
    const detail = (await request(app).get(`/api/presentations/${p.id}`)).body;
    expect(detail.slides.map((s: { lyrics: string; position: number }) => [s.lyrics, s.position])).toEqual([
      ["B2\nsecond line", 0],
      ["C", 1],
    ]);
  });

  it("reorders slides and rejects a stale or invalid order", async () => {
    const p = (await request(app).post("/api/presentations").send({ name: "Song" })).body;
    const ids: number[] = [];
    for (const lyrics of ["1", "2", "3"]) {
      ids.push((await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics })).body.id);
    }
    const reordered = await request(app)
      .put(`/api/presentations/${p.id}/slides/order`)
      .send({ slideIds: [ids[2], ids[0], ids[1]] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.map((s: { lyrics: string }) => s.lyrics)).toEqual(["3", "1", "2"]);

    // Missing a slide (stale client) must not silently drop it.
    const stale = await request(app).put(`/api/presentations/${p.id}/slides/order`).send({ slideIds: [ids[0], ids[1]] });
    expect(stale.status).toBe(409);
    const dup = await request(app).put(`/api/presentations/${p.id}/slides/order`).send({ slideIds: [ids[0], ids[0], ids[1]] });
    expect(dup.status).toBe(409);
    expect((await request(app).put(`/api/presentations/${p.id}/slides/order`).send({ slideIds: "x" })).status).toBe(400);
  });

  it("duplicates a presentation with its slides and notes", async () => {
    const p = (await request(app).post("/api/presentations").send({ name: "Hymn" })).body;
    await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "Verse", notes: "slow" });
    const copy = await request(app).post(`/api/presentations/${p.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.name).toBe("Hymn (copy)");
    const detail = (await request(app).get(`/api/presentations/${copy.body.id}`)).body;
    expect(detail.slides).toHaveLength(1);
    expect(detail.slides[0]).toMatchObject({ lyrics: "Verse", notes: "slow" });
    // The original is unchanged and the copy is independent.
    await request(app).delete(`/api/presentations/${p.id}`);
    expect((await request(app).get(`/api/presentations/${copy.body.id}`)).body.slides).toHaveLength(1);
  });

  it("deleting a presentation removes its slides", async () => {
    const p = (await request(app).post("/api/presentations").send({ name: "Gone" })).body;
    const s = (await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "x" })).body;
    await request(app).delete(`/api/presentations/${p.id}`);
    expect((await request(app).patch(`/api/slides/${s.id}`).send({ lyrics: "y" })).status).toBe(404);
  });

  it("returns JSON errors for bad ids, bad JSON and unknown routes", async () => {
    expect((await request(app).get("/api/presentations/abc")).status).toBe(404);
    const badJson = await request(app).post("/api/presentations").set("Content-Type", "application/json").send("{oops");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toBeTruthy();
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });

  it("rejects over-long slide text", async () => {
    const p = (await request(app).post("/api/presentations").send({ name: "Long" })).body;
    const res = await request(app).post(`/api/presentations/${p.id}/slides`).send({ lyrics: "x".repeat(10_001) });
    expect(res.status).toBe(400);
  });
});

describe("APP_PASSWORD gate", () => {
  it("is open when no password is configured", async () => {
    const app = makeApp();
    expect((await request(app).get("/api/session")).body).toEqual({ authRequired: false, authenticated: true });
    expect((await request(app).get("/api/presentations")).status).toBe(200);
  });

  it("blocks the API until the right password is given", async () => {
    const app = makeApp("hunter2");
    expect((await request(app).get("/api/presentations")).status).toBe(401);
    expect((await request(app).post("/api/presentations").send({ name: "x" })).status).toBe(401);
    expect((await request(app).get("/api/session")).body).toEqual({ authRequired: true, authenticated: false });

    const bad = await request(app).post("/api/login").send({ password: "wrong" });
    expect(bad.status).toBe(401);

    const agent = request.agent(app);
    const ok = await agent.post("/api/login").send({ password: "hunter2" });
    expect(ok.status).toBe(200);
    expect(String(ok.headers["set-cookie"])).toContain("HttpOnly");
    expect((await agent.get("/api/presentations")).status).toBe(200);
    expect((await agent.get("/api/session")).body.authenticated).toBe(true);

    await agent.post("/api/logout");
    expect((await agent.get("/api/presentations")).status).toBe(401);
  });

  it("rate-limits repeated wrong passwords", async () => {
    const app = makeApp("hunter2");
    for (let i = 0; i < 10; i++) await request(app).post("/api/login").send({ password: "nope" });
    const blocked = await request(app).post("/api/login").send({ password: "hunter2" });
    expect(blocked.status).toBe(429);
  });

  it("keeps /healthz open for Railway", async () => {
    expect((await request(makeApp("hunter2")).get("/healthz")).status).toBe(200);
  });
});
