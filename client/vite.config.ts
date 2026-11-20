import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: path.resolve(root, "../dist/client"), emptyOutDir: true },
  server: {
    port: 5173,
    // The client imports ../shared (types + settings helpers), which lives outside client/.
    fs: { allow: [path.resolve(root, "..")] },
    // In dev, forward API, health, video and WebSocket requests to the Node server.
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/media": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
