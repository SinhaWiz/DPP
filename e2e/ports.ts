import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The end-to-end run uses its own node, backend and web server, so it never touches a developer's. */
export const PORTS = { node: 18545, backend: 14000, web: 15173 } as const;

export const RUN_DIR = process.env.E2E_RUN_DIR ?? (process.env.E2E_RUN_DIR = mkdtempSync(join(tmpdir(), "ledger-e2e-")));
export const DEPLOYMENT_PATH = join(RUN_DIR, "deployment.json");
export const DB_PATH = join(RUN_DIR, "index.sqlite");
