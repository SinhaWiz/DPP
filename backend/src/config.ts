import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = fileURLToPath(new URL(".", import.meta.url));

const schema = z.object({
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  /** Lab endpoints are only safe on a loopback address, so this is the default and the lab checks it. */
  HOST: z.string().default("127.0.0.1"),
  /** SQLite file, or ":memory:". */
  DB_PATH: z.string().default(resolve(here, "../data/index.sqlite")),
  DEPLOYMENT_PATH: z
    .string()
    .default(resolve(here, "../../packages/shared/src/generated/deployment.json")),
  /** How often the indexer polls the node for new blocks. */
  POLL_MS: z.coerce.number().int().min(10).default(400),
  /** Trace successful transactions to record which storage slots they wrote (for the Storage explorer). */
  TRACE_STORAGE: z
    .enum(["0", "1", "true", "false"])
    .default("1")
    .transform((v) => v === "1" || v === "true"),
  /** Origins allowed to call the API from a browser. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

/** Parses environment variables into a validated config. Pass overrides in tests. */
export function loadConfig(env: Record<string, string | undefined> = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return { ...parsed.data, ...overrides };
}
