import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { installErrorHandler } from "./api/errors";
import { registerChainRoutes, registerLedgerRoutes } from "./api/routes";
import type { Services } from "./services";

/** Builds the HTTP server on top of the running services. */
export async function buildApp(s: Services): Promise<FastifyInstance> {
  const app = Fastify({ logger: s.config.LOG_LEVEL === "silent" ? false : { level: s.config.LOG_LEVEL } });
  await app.register(cors, { origin: s.config.CORS_ORIGINS });
  installErrorHandler(app);

  app.get("/health", async () => ({ ok: true, seq: s.bus.lastSeq }));
  registerLedgerRoutes(app, s);
  registerChainRoutes(app, s);
  return app;
}
