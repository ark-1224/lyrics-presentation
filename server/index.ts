import fs from "node:fs";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
for (const warning of config.warnings) console.warn(`[warn] ${warning}`);

const app = createApp(config);
// 0.0.0.0 so the Railway proxy (and other devices on the LAN in local use) can reach us.
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Lyric presenter listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir} (persistent: ${config.persistent})`);
});

// Railway sends SIGTERM on redeploy: stop accepting connections and exit cleanly.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
