import fs from "node:fs";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
for (const warning of config.warnings) console.warn(`[warn] ${warning}`);
if (!config.appPassword) console.warn("[warn] APP_PASSWORD is not set: the control panel is open to anyone who can reach it.");

const db = openDb(config.dataDir);
const app = createApp(config, db);
// 0.0.0.0 so the Railway proxy (and other devices on the LAN in local use) can reach us.
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Lyric presenter listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir} (persistent: ${config.persistent})`);
});

// Railway sends SIGTERM on redeploy: stop accepting connections and exit cleanly.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
