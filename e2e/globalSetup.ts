import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { DEPLOYMENT_PATH, PORTS } from "./ports";

const root = resolve(__dirname, "..");

function hardhat(script: string, extra: Record<string, string> = {}) {
  const r = spawnSync("npx", ["hardhat", "run", script, "--network", "localhost"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, DEV_NODE: "1", HARDHAT_RPC_URL: `http://127.0.0.1:${PORTS.node}`, DEPLOYMENT_PATH, ...extra },
  });
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
}

/** Deploys the contracts and loads the sample story (including deliberate failures) before any test runs. */
export default async function globalSetup() {
  hardhat("scripts/deploy.js");
  hardhat("scripts/seed.js", { WITH_FAILURES: "1" });

  // wait for the backend to index it all
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const s = await (await fetch(`http://127.0.0.1:${PORTS.backend}/api/session`)).json();
      if (s.indexer.state === "live" && s.ledgerLength > 30) return warmUp();
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("The backend did not finish indexing the sample data in time.");
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Vite optimises dependencies the first time a page asks for them and then reloads that page. Doing it
 * here, once, keeps that reload from landing in the middle of the first test.
 */
async function warmUp() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of ["/", "/storage", "/tamper", "/learn"]) {
      await page.goto(`http://127.0.0.1:${PORTS.web}${path}`);
      await page.getByRole("status", { name: /^Backend/ }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
    }
  } finally {
    await browser.close();
  }
}
