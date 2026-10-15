import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract } from "ethers";
import {
  DropResultSchema, LabStatusSchema, MineResultSchema, MiningStateSchema, ReplaceResultSchema, RestoreResultSchema, ROUTES,
  ScenarioListSchema, ScenarioRunSchema, SnapshotListSchema, SnapshotSchema, TamperListSchema, TamperResultSchema, TimeResultSchema,
  UndoAllSchema,
} from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";

describe("API contract", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("every route in the shared route table is implemented by the server", async () => {
    const app = await h.app();
    for (const r of ROUTES) {
      const url = r.path.replace(/\{(\w+)\}/g, ":$1");
      expect(app.hasRoute({ method: r.method.toUpperCase() as "GET" | "POST", url }), `${r.method} ${r.path}`).toBe(true);
    }
  });

  it("every lab route answers with the documented shape", async () => {
    const ok = async <T>(req: Promise<{ status: number; body: T }>) => {
      const r = await req;
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };

    LabStatusSchema.parse(await ok(h.get("/api/lab/status")));
    MiningStateSchema.parse(await ok(h.post("/api/lab/mining", { mode: "manual" })));

    // a pending transaction to drop, and another to replace
    const market = h.deployed.market;
    const send = (signer: number, fn: string, ...args: unknown[]) => (market.connect(h.deployed.signers[signer]!) as Contract).getFunction(fn)(...args);
    const toDrop = await send(1, "buy", 1, { value: eth("1") });
    await h.watcher.poll();
    DropResultSchema.parse(await ok(h.post(`/api/lab/txs/${toDrop.hash}/drop`)));
    const toReplace = await send(2, "registerProduct", "Replaceable");
    await h.watcher.poll();
    ReplaceResultSchema.parse(await ok(h.post(`/api/lab/txs/${toReplace.hash}/replace`, { mode: "cancel" })));

    MineResultSchema.parse(await ok(h.post("/api/lab/mine", { blocks: 1 })));
    MiningStateSchema.parse(await ok(h.post("/api/lab/mining", { mode: "auto" })));
    TimeResultSchema.parse(await ok(h.post("/api/lab/time", { seconds: 60 })));

    SnapshotSchema.parse(await ok(h.post("/api/lab/snapshots", { name: "contract" })));
    expect(SnapshotListSchema.parse(await ok(h.get("/api/lab/snapshots"))).snapshots).toHaveLength(1);

    const attack = TamperResultSchema.parse(await ok(h.post("/api/lab/tamper", { index: 1, field: "price", value: "5", mode: "data" })));
    expect(TamperListSchema.parse(await ok(h.get("/api/lab/tamper"))).attacks).toHaveLength(1);
    expect(TamperResultSchema.parse(await ok(h.post(`/api/lab/tamper/${attack.groupId}/undo`))).mode).toBe("undo");
    await ok(h.post("/api/lab/tamper", { index: 1, field: "price", value: "6", mode: "data+hash" }));
    expect(UndoAllSchema.parse(await ok(h.post("/api/lab/tamper/undo-all"))).undone).toHaveLength(1);

    ScenarioListSchema.parse(await ok(h.get("/api/lab/scenarios")));
    ScenarioRunSchema.parse(await ok(h.post("/api/lab/scenarios/bulk", { count: 1 })));
    RestoreResultSchema.parse(await ok(h.post("/api/lab/restore", { name: "contract" })));
  });
});
