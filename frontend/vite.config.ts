import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const BACKEND = process.env.VITE_BACKEND ?? "http://127.0.0.1:4000";
const NODE = process.env.VITE_NODE ?? "http://127.0.0.1:8545";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // The browser talks to one origin; the dev server forwards API and WebSocket traffic to the backend.
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND.replace(/^http/, "ws"), ws: true },
      // Demo mode signs with the node's unlocked accounts through the same origin (no CORS to worry about).
      "/rpc": { target: NODE, changeOrigin: true, rewrite: () => "/" },
    },
  },
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // a few tests start a real Hardhat node; do not run too many files at once
    pool: "forks",
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
