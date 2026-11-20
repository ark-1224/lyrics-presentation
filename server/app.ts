import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Config } from "./config.js";

/** Folder with the built React app (produced by `npm run build:client`). */
const CLIENT_DIST = path.resolve(import.meta.dirname, "../client");

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function createApp(config: Config) {
  const app = express();
  app.disable("x-powered-by");

  /**
   * Health check used by Railway (see railway.json). Returns 503 if the data folder
   * can't be written to, so a broken volume mount fails the deploy instead of going live.
   */
  app.get("/healthz", (_req, res) => {
    const storageOk = isWritable(config.dataDir);
    res.status(storageOk ? 200 : 503).json({
      status: storageOk ? "ok" : "storage-unavailable",
      uptimeSeconds: Math.round(process.uptime()),
      persistentStorage: config.persistent,
    });
  });

  // Serve the built frontend. In dev, Vite serves it instead, so this folder may not exist.
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    // /control and /display/* are client-side routes: always answer with index.html.
    app.get(/^\/(?!api\/|healthz).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  }

  return app;
}
