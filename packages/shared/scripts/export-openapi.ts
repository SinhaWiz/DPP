// Writes docs/openapi.json from the zod schemas.   npm run export:openapi
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "../src/openapi";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApi(), null, 2) + "\n");
console.log("Wrote", out);
