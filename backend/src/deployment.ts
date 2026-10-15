import { existsSync, readFileSync, statSync } from "node:fs";
import { parseDeployment, type Deployment } from "@dpp/shared";

/** Reads and validates deployment.json; returns null if it does not exist yet. */
export function readDeploymentFile(path: string): Deployment | null {
  if (!existsSync(path)) return null;
  return parseDeployment(JSON.parse(readFileSync(path, "utf8")));
}

/** Modification time, used to notice that `npm run dev:deploy` was run again. */
export function deploymentMtime(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}
