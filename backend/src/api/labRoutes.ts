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

    const hashParam = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "hash must be 0x followed by 64 hex characters") });

    lab.post("/api/lab/txs/:hash/drop", async (req) => s.lab.dropTx(hashParam.parse(req.params).hash));

    lab.post("/api/lab/txs/:hash/replace", async (req) => {
      const { hash } = hashParam.parse(req.params);
      const body = z.object({ mode: z.enum(["cancel", "speedUp"]) }).parse(req.body);
      return s.lab.replaceTx(hash, body.mode);
    });

    lab.get("/api/lab/tamper", async () => ({ attacks: s.lab.tamper.active() }));
    lab.post("/api/lab/tamper", async (req) => {
      const body = z
        .object({
          index: z.union([z.string().regex(/^\d+$/), z.number().int().min(0)]),
          field: z.enum(["index", "timestamp", "productId", "action", "actor", "counterparty", "price", "prevHash", "hash"]),
          value: z.union([z.string(), z.number()]),
          mode: z.enum(["data", "data+hash", "rewrite-tail"]).default("data"),
        })
        .parse(req.body);
      return s.lab.tamper.tamper(body);
    });
    lab.post("/api/lab/tamper/undo-all", async () => s.lab.tamper.undoAll());
    lab.post("/api/lab/tamper/:groupId/undo", async (req) => s.lab.tamper.undo(z.object({ groupId: z.string().min(1) }).parse(req.params).groupId));

    lab.get("/api/lab/snapshots", async () => ({ snapshots: s.lab.listSnapshots() }));
    lab.post("/api/lab/snapshots", async (req) => s.lab.snapshot(z.object({ name: z.string() }).parse(req.body).name));
    lab.post("/api/lab/restore", async (req) => s.lab.restore(z.object({ name: z.string() }).parse(req.body).name));

    lab.post("/api/lab/time", async (req) => {
      const body = z.object({ seconds: z.number().int() }).parse(req.body);
      return s.lab.increaseTime(body.seconds);
    });
  });
}

export { LabError };
