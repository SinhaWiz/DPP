import { existsSync, readFileSync, statSync } from "node:fs";
import { parseDeployment, type Deployment } from "@dpp/shared";
import { Bus } from "./bus";
import { createRpc, type Rpc } from "./chain/rpc";
import type { Config } from "./config";
import { Repo } from "./db/repo";
import { Indexer } from "./indexer/indexer";
import { Lab } from "./lab/lab";
import { MempoolWatcher } from "./lifecycle/mempoolWatcher";
import { createLogger, type Logger } from "./logger";
import { VerificationService } from "./verification";

export interface Services {
  config: Config;
  log: Logger;
  bus: Bus;
  rpc: Rpc;
  repo: Repo;
  verification: VerificationService;
  indexer: Indexer;
  watcher: MempoolWatcher;
  lab: Lab;
  start(): void;
  stop(): Promise<void>;
}

/** Reads deployment.json, re-parsing only when the file changed (`npm run dev:deploy` rewrites it). */
export function deploymentProvider(path: string): () => Deployment | null {
  let mtime = 0;
  let cached: Deployment | null = null;
  return () => {
    if (!existsSync(path)) {
      cached = null;
      mtime = 0;
      return null;
    }
    const m = statSync(path).mtimeMs;
    if (m !== mtime) {
      try {
        cached = parseDeployment(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        cached = null; // half-written or invalid file: try again on the next pass
        return null;
      }
      mtime = m;
    }
    return cached;
  };
}

export interface ServiceOverrides {
  getDeployment?: () => Deployment | null;
  rpc?: Rpc;
  repo?: Repo;
}

/** Wires the indexer, lifecycle tracker and verification together. Nothing runs until `start()`. */
export function createServices(config: Config, overrides: ServiceOverrides = {}): Services {
  const log = createLogger(config.LOG_LEVEL);
  const bus = new Bus();
  const rpc = overrides.rpc ?? createRpc(config.RPC_URL);
  const repo = overrides.repo ?? Repo.open(config.DB_PATH);
  const verification = new VerificationService(repo, bus);
  const getDeployment = overrides.getDeployment ?? deploymentProvider(config.DEPLOYMENT_PATH);

  // The watcher needs the indexer's decoder, and the indexer calls the watcher after each pass.
  // The late-bound reference keeps the two decoupled.
  let watcher!: MempoolWatcher;
  const indexer = new Indexer({
    rpc, repo, bus, log, getDeployment, verification,
    pollMs: config.POLL_MS,
    traceStorage: config.TRACE_STORAGE,
    afterPass: async () => { await watcher.poll(); },
  });
  watcher = new MempoolWatcher({ rpc, repo, bus, log, indexer });
  const lab = new Lab({ config, rpc, repo, bus, log, indexer, watcher, verification });

  return {
    config, log, bus, rpc, repo, verification, indexer, watcher, lab,
    start: () => indexer.start(),
    stop: async () => {
      lab.dispose();
      await indexer.stop();
      rpc.destroy();
      repo.close();
    },
  };
}
