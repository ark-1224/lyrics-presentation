import fs from "node:fs";
import http from "node:http";
import { createApp, createServices } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { attachWebSocket } from "./ws.js";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
for (const warning of config.warnings) console.warn(`[warn] ${warning}`);
if (!config.appPassword) console.warn("[warn] APP_PASSWORD is not set: the control panel is open to anyone who can reach it.");

const db = openDb(config.dataDir);
const services = createServices(config, db);
const app = createApp(config, services);

// A plain http server so the WebSocket endpoint (/ws) can share the same port as the web app.
const server = http.createServer(app);
const sockets = attachWebSocket(server, services);

// 0.0.0.0 so the Railway proxy (and other devices on the LAN in local use) can reach us.
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Lyric presenter listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir} (persistent: ${config.persistent})`);
});

// Railway sends SIGTERM on redeploy: stop accepting connections and exit cleanly.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  sockets.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
