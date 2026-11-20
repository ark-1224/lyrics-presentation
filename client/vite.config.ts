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
    // In dev, forward API and health requests to the Node server.
    proxy: { "/api": "http://localhost:3000", "/healthz": "http://localhost:3000" },
  },
});
