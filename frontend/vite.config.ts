import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

/** Serves the latest deployment file at /deployment.json, so the browser can read the chain even without the backend. */
function deploymentFile(): import("vite").Plugin {
  // DEPLOYMENT_PATH lets the end-to-end tests point at their own deployment instead of the developer's.
  const path = process.env.DEPLOYMENT_PATH ?? resolve(fileURLToPath(new URL(".", import.meta.url)), "../packages/shared/src/generated/deployment.json");
  const serve = (_req: unknown, res: import("node:http").ServerResponse, next: () => void) => {
    if ((_req as { url?: string }).url?.split("?")[0] !== "/deployment.json") return next();
    if (!existsSync(path)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "not_found", message: "No deployment yet. Run `npm run dev:deploy`." } }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(readFileSync(path));
  };
  return { name: "deployment-file", configureServer: (s) => void s.middlewares.use(serve), configurePreviewServer: (s) => void s.middlewares.use(serve) };
}

const BACKEND = process.env.VITE_BACKEND ?? "http://127.0.0.1:4000";
const NODE = process.env.VITE_NODE ?? "http://127.0.0.1:8545";

export default defineConfig({
  plugins: [react(), tailwindcss(), deploymentFile()],
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
