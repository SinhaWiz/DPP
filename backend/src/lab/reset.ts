import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Lab } from "./lab";
import { LabError } from "./lab";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function runHardhat(script: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("npx", ["hardhat", "run", script, "--network", "localhost"], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolveRun(out) : reject(new Error(`${script} failed (exit ${code}):\n${out.slice(-600)}`))));
  });
}

/**
 * Redeploys the contracts on the running node and (optionally) loads the sample data, by running the
 * same `deploy.js` and `seed.js` used from the command line. The indexer notices the new deployment
 * and starts over.
 */
export async function resetChain(lab: Lab, options: { seed: boolean; withFailures: boolean }): Promise<{ seeded: boolean }> {
  const env = {
    DEV_NODE: "1",
    HARDHAT_RPC_URL: lab.d.config.RPC_URL,
    DEPLOYMENT_PATH: lab.d.config.DEPLOYMENT_PATH,
    WITH_FAILURES: options.withFailures ? "1" : "0",
  };
  try {
    await runHardhat("scripts/deploy.js", env);
    if (options.seed) await runHardhat("scripts/seed.js", env);
  } catch (e) {
    throw new LabError(500, "reset_failed", e instanceof Error ? e.message : String(e));
  }
  // let the indexer see the new deployment (it wipes the old index) and catch up
  await lab.settle();
  await lab.settle();
  return { seeded: options.seed };
}
