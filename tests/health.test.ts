import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.js";
import { makeTestApp } from "./helpers.js";

describe("health check", () => {
  it("returns 200 when the data folder is writable", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns 503 when the data folder is missing", async () => {
    const { app, config } = makeTestApp();
    fs.rmSync(config.dataDir, { recursive: true, force: true }); // simulate a missing/unmounted volume
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(503);
  });
});

describe("loadConfig", () => {
  it("defaults to port 3000 and ./data", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.dataDir).toBe(path.resolve("data"));
    expect(c.warnings).toEqual([]);
  });

  it("reads PORT from the environment", () => {
    expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow();
  });

  it("prefers DATA_DIR, then the Railway volume path", () => {
    expect(loadConfig({ DATA_DIR: "/x", RAILWAY_VOLUME_MOUNT_PATH: "/data" }).dataDir).toBe(path.resolve("/x"));
    expect(loadConfig({ RAILWAY_VOLUME_MOUNT_PATH: "/data" }).dataDir).toBe(path.resolve("/data"));
  });

  it("warns on Railway when no volume is attached", () => {
    const c = loadConfig({ RAILWAY_ENVIRONMENT: "production" });
    expect(c.persistent).toBe(false);
    expect(c.warnings).toHaveLength(1);
  });

  it("does not warn on Railway when a volume is attached", () => {
    const c = loadConfig({ RAILWAY_ENVIRONMENT: "production", RAILWAY_VOLUME_MOUNT_PATH: "/data" });
    expect(c.persistent).toBe(true);
    expect(c.warnings).toEqual([]);
  });
});
