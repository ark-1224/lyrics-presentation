import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { createAuth } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { createLive } from "./live.js";
import { createRepo } from "./repo.js";
import { presentationRoutes } from "./routes/presentations.js";
import { mediaRoute, videoRoutes } from "./routes/videos.js";

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

/** The long-lived pieces shared by the HTTP routes and the WebSocket layer. */
export function createServices(config: Config, db: Db) {
  fs.mkdirSync(config.videosDir, { recursive: true });
  const repo = createRepo(db);
  const auth = createAuth(config.appPassword);
  const live = createLive(repo);
  return { repo, auth, live };
}
export type Services = ReturnType<typeof createServices>;

export function createApp(config: Config, services: Services) {
  const { repo, auth, live } = services;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Railway terminates HTTPS in front of us; needed for req.secure / req.ip
  app.use(express.json({ limit: "1mb" }));

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

  // Video files are public (display windows load them); see mediaRoute.
  app.use(mediaRoute(repo, config));

  // --- API -----------------------------------------------------------------------------
  const api = express.Router();
  // These three work without a session so the login screen can function.
  api.get("/session", auth.session);
  api.post("/login", auth.login);
  api.post("/logout", auth.logout);
  // Everything below needs the shared password (when APP_PASSWORD is set).
  api.use(auth.requireAuth);
  api.use(presentationRoutes(repo, live.refresh));
  api.use(videoRoutes(repo, config, live.refresh));
  api.use((_req, res) => void res.status(404).json({ error: "Not found" }));
  app.use("/api", api);

  // Serve the built frontend. In dev, Vite serves it instead, so this folder may not exist.
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    // /control and /display/* are client-side routes: always answer with index.html.
    app.get(/^\/(?!api\/|healthz|media\/|ws).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  }

  // Turn body-parser failures (bad JSON, too large) into clean JSON instead of an HTML stack trace.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only treats it as an error handler with 4 params
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Server error" : "Invalid request" });
  };
  app.use(onError);

  return app;
}
