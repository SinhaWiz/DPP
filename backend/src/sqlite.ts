import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

/**
 * Node's built-in SQLite. It is loaded through `require` because Vite/Vitest strip the `node:` prefix
 * from `node:sqlite` and then fail to resolve it; going through createRequire avoids that and also
 * works unchanged under tsx.
 */
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type Database = DatabaseSyncType;
export { DatabaseSync };
