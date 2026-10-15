import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../services";
import { LabError } from "../lab/lab";

/** Every /api/lab route first checks that the lab may run at all (chain 31337, loopback API). */
export async function registerLabRoutes(app: FastifyInstance, s: Services): Promise<void> {
  await app.register(async (lab) => {
    lab.addHook("preHandler", async () => {
      await s.lab.assertAvailable();
    });

    lab.get("/api/lab/status", async () => ({
      mining: await s.lab.mining(),
      clients: s.lab.connectedClients,
    }));

    lab.post("/api/lab/mining", async (req) => {
      const body = z
        .object({ mode: z.enum(["auto", "manual", "interval"]), intervalMs: z.number().int().optional() })
        .parse(req.body);
      return s.lab.setMining(body.mode, body.intervalMs);
    });

    lab.post("/api/lab/mine", async (req) => {
      const body = z.object({ blocks: z.number().int().optional() }).parse(req.body ?? {});
      return s.lab.mine(body.blocks ?? 1);
    });

    lab.post("/api/lab/time", async (req) => {
      const body = z.object({ seconds: z.number().int() }).parse(req.body);
      return s.lab.increaseTime(body.seconds);
    });
  });
}

export { LabError };
