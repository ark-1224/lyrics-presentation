import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createApp, createServices } from "../server/app.js";
import type { Config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { attachWebSocket } from "../server/ws.js";

/** A fresh config pointing at a throwaway data folder. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lyrics-test-"));
  return {
    port: 0,
    dataDir,
    persistent: true,
    warnings: [],
    maxVideoMb: 500,
    videosDir: path.join(dataDir, "videos"),
    maxPptxMb: 50,
    ...overrides,
  };
}

/** Express app + services backed by an in-memory database (use with supertest). */
export function makeTestApp(overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const services = createServices(config, openDb(":memory:"));
  return { app: createApp(config, services), config, ...services };
}

/** The same, but listening on a random port with the WebSocket endpoint attached. */
export async function startTestServer(overrides: Partial<Config> = {}) {
  const t = makeTestApp(overrides);
  const server = http.createServer(t.app);
  const sockets = attachWebSocket(server, t);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    ...t,
    port,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
