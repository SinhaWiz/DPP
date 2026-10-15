import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { DB_PATH, DEPLOYMENT_PATH, PORTS } from "./ports";

const root = resolve(__dirname, "..");
const node = `http://127.0.0.1:${PORTS.node}`;

export default defineConfig({
  testDir: "./tests",
  // One shared chain, so tests run one after another and put things back as they found them.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./globalSetup.ts",
  use: { baseURL: `http://127.0.0.1:${PORTS.web}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `DEV_NODE=1 npx hardhat node --hostname 127.0.0.1 --port ${PORTS.node}`,
      cwd: root, port: PORTS.node, reuseExistingServer: false, timeout: 60_000,
    },
    {
      command: "npm run start -w @dpp/backend",
      cwd: root, url: `http://127.0.0.1:${PORTS.backend}/health`, reuseExistingServer: false, timeout: 60_000,
      env: { RPC_URL: node, PORT: String(PORTS.backend), DB_PATH, DEPLOYMENT_PATH, POLL_MS: "150", LOG_LEVEL: "warn", LAB_GRACE_MS: "60000", CORS_ORIGINS: `http://127.0.0.1:${PORTS.web}` },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${PORTS.web} --strictPort`,
      cwd: resolve(root, "frontend"), url: `http://127.0.0.1:${PORTS.web}`, reuseExistingServer: false, timeout: 60_000,
      env: { VITE_BACKEND: `http://127.0.0.1:${PORTS.backend}`, VITE_NODE: node, DEPLOYMENT_PATH },
    },
  ],
});
