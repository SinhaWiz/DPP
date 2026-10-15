import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bus } from "./bus";
import type { Config } from "./config";

export interface AppContext {
  config: Config;
  bus: Bus;
}

/** Builds the HTTP server. Routes are registered by later phases. */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: ctx.config.LOG_LEVEL === "silent" ? false : { level: ctx.config.LOG_LEVEL } });
  await app.register(cors, { origin: ctx.config.CORS_ORIGINS });

  // BigInt is not JSON-serializable; amounts and indexes are sent as decimal strings.
  app.addHook("preSerialization", async (_req, _reply, payload) => payload);

  app.get("/health", async () => ({ ok: true, seq: ctx.bus.lastSeq }));
  return app;
}
