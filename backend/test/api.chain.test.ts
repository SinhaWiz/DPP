import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlockListSchema, buildFieldWrite, computeHash, ErrorSchema, recordSlot, RecordDetailSchema, StorageRecordSchema, TxDetailSchema,
  TxListSchema, VerifySchema, word, type RecordMember,
} from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { rowToRecord } from "../src/verification";

async function tamper(h: Harness, index: number, field: RecordMember, value: bigint) {
  const address = h.deployment.contracts.market.address;
  const current = BigInt(await h.rpc.send<string>("eth_getStorageAt", [address, word(recordSlot(index, field)), "latest"]));
  const w = buildFieldWrite(index, field, value, current);
  await h.rpc.send("hardhat_setStorageAt", [address, word(w.slot), word(w.value)]);
}

describe("API: records, transactions, blocks, verification and storage", () => {
  let h: Harness;
  let failedHash: string;
  let saleHash: string;

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    failedHash = await h.callFailing(4, "listForSale", 1, eth("1"));
    await h.call(1, "listForSale", 1, eth("2"));
    await h.indexer.syncOnce();
    saleHash = h.repo.getRecord(2)!.txHash!;
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  describe("GET /api/records/:index", () => {
    it("breaks the hash into its eight fields and reproduces the stored hash", async () => {
      const { status, body } = await h.get("/api/records/2");
      expect(status).toBe(200);
      const r = RecordDetailSchema.parse(body);
      expect(r.hashSteps.fields.map((f) => f.name)).toEqual(["index", "timestamp", "productId", "action", "actor", "counterparty", "price", "prevHash"]);
      expect(r.hashSteps.fields.every((f) => f.word.length === 66)).toBe(true);
      expect(r.hashSteps.encoded.length).toBe(2 + 256 * 2);
      expect(r.hashSteps.hash).toBe(r.hash);
      expect(r.tx).toMatchObject({ hash: saleHash, functionName: "buy", state: "mined", recordIndex: "2" });
    });

    it("404s for an index that does not exist, 400 for a malformed one", async () => {
      expect((await h.get("/api/records/99")).status).toBe(404);
      expect((await h.get("/api/records/-1")).status).toBe(400);
    });
  });

  describe("GET /api/txs", () => {
    it("lists every kind of transaction, newest first, with decoded calls", async () => {
      const list = TxListSchema.parse((await h.get("/api/txs")).body);
      expect(list.total).toBe(7);
      // the last two are the contracts' own deployment transactions
      expect(list.txs.map((t) => t.functionName)).toEqual(["listForSale", "listForSale", "buy", "listForSale", "registerProduct", "deploy", "deploy"]);
      expect(list.txs.map((t) => t.state)).toEqual(["mined", "failed", "mined", "mined", "mined", "mined", "mined"]);
    });

    it("filters by state and sender, and pages", async () => {
      const failed = TxListSchema.parse((await h.get("/api/txs?state=failed")).body);
      expect(failed.total).toBe(1);
      expect(failed.txs[0]!.hash).toBe(failedHash);

      const outsider = h.deployment.roles[4]!.address;
      expect(TxListSchema.parse((await h.get(`/api/txs?from=${outsider}`)).body).txs).toHaveLength(1);

      const page = TxListSchema.parse((await h.get("/api/txs?limit=2&offset=1")).body);
      expect(page.txs).toHaveLength(2);
      expect(page.total).toBe(7);
      expect(TxListSchema.parse((await h.get("/api/txs?state=dropped")).body).total).toBe(0);
    });

    it("explains a failed transaction in the list itself", async () => {
      const t = TxListSchema.parse((await h.get("/api/txs?state=failed")).body).txs[0]!;
      expect(t.status).toBe(0);
      expect(t.revert).toMatchObject({ name: "NotProductOwner", approximate: false });
      expect(t.revert!.explanation).toContain("Outsider");
      expect(t.revert!.fix.length).toBeGreaterThan(5);
      expect(t.recordIndex).toBeNull();
    });

    it("rejects an unknown state", async () => {
      expect((await h.get("/api/txs?state=exploded")).status).toBe(400);
    });
  });

  describe("GET /api/txs/:hash", () => {
    it("shows the full life of a successful transaction", async () => {
      const t = TxDetailSchema.parse((await h.get(`/api/txs/${saleHash}`)).body);
      expect(t.stages.map((s) => s.key)).toEqual(["pending", "mined", "recorded", "verified"]);
      expect(t.stages.at(-1)).toMatchObject({ done: true, current: true });
      expect(t.events.map((e) => e.name)).toEqual(["RecordAppended", "ProductSold"]);
      expect(t.record).toMatchObject({ index: "2", actionLabel: "Sold" });
      expect(t.explanation).toBeNull();
    });

    it("lists the storage writes with gas and what kind of write each was", async () => {
      const t = TxDetailSchema.parse((await h.get(`/api/txs/${saleHash}`)).body);
      expect(t.storageWrites.length).toBeGreaterThan(8);
      const kinds = new Set(t.storageWrites.map((w) => w.kind));
      expect(kinds.has("new")).toBe(true);
      expect(kinds.has("update")).toBe(true);
      const total = t.storageWrites.reduce((n, w) => n + (w.gasCost ?? 0), 0);
      expect(total).toBeGreaterThan(100_000);
      expect(total).toBeLessThan(Number(t.gasUsed));
    });

    it("shows a failed transaction as reverted, explained and unrecorded", async () => {
      const t = TxDetailSchema.parse((await h.get(`/api/txs/${failedHash}`)).body);
      expect(t.state).toBe("failed");
      expect(t.stages.map((s) => s.key)).toEqual(["pending", "mined", "explained"]);
      expect(t.stages[1]!.label).toBe("Mined (reverted)");
      expect(t.explanation!.title).toBe("Not the owner");
      expect(t.events).toEqual([]);
      expect(t.storageWrites).toEqual([]);
      expect(t.record).toBeNull();
      expect(BigInt(t.gasUsed!)).toBeGreaterThan(0n); // gas was spent anyway
    });

    it("accepts an upper-case hash, 404s for unknown and 400s for malformed", async () => {
      expect((await h.get(`/api/txs/${saleHash.toUpperCase().replace("0X", "0x")}`)).status).toBe(200);
      expect((await h.get(`/api/txs/0x${"ab".repeat(32)}`)).status).toBe(404);
      const bad = await h.get("/api/txs/0x123");
      expect(bad.status).toBe(400);
      expect(ErrorSchema.parse(bad.body).error.message).toContain("64 hex");
    });
  });

  describe("GET /api/blocks", () => {
    it("returns blocks with their transactions and the records they produced", async () => {
      const { blocks } = BlockListSchema.parse((await h.get("/api/blocks")).body);
      const latest = blocks.at(-1)!;
      expect(latest.number).toBe(h.repo.latestBlock()!.number);
      const withSale = blocks.find((b) => b.txs.some((t) => t.functionName === "buy"))!;
      expect(withSale.records).toEqual(["2"]);
      const withFailure = blocks.find((b) => b.txs.some((t) => t.state === "failed"))!;
      expect(withFailure.records).toEqual([]); // a failed transaction is in a block but wrote no record

      // each block's hash is what the node says
      const onChain = await h.rpc.send<{ hash: string }>("eth_getBlockByNumber", ["0x" + latest.number.toString(16), false]);
      expect(latest.hash).toBe(onChain.hash);
    });

    it("honours from/to and refuses huge ranges", async () => {
      const { blocks } = BlockListSchema.parse((await h.get("/api/blocks?from=3&to=4")).body);
      expect(blocks.map((b) => b.number)).toEqual([3, 4]);
      expect((await h.get("/api/blocks?from=0&to=500")).status).toBe(200); // clamped to what exists
    });
  });

  describe("GET /api/verify", () => {
    it("agrees with the contract on an intact ledger", async () => {
      const v = VerifySchema.parse((await h.get("/api/verify")).body);
      expect(v.offChain).toMatchObject({ valid: true, recordCount: 4, brokenIndexes: [] });
      expect(v.onChain).toMatchObject({ valid: true, audit: { brokenIndexes: [], reasons: [] } });
      expect(v.comparison).toEqual({ agree: true, contractFooled: false, notes: [] });
    });
  });

  describe("GET /api/storage/records/:index", () => {
    it("matches the layout maths against the node's storage, slot by slot", async () => {
      const s = StorageRecordSchema.parse((await h.get("/api/storage/records/2")).body);
      expect(s.slots).toHaveLength(8);
      expect(s.slots.every((x) => x.match)).toBe(true);
      expect(s.slots[3]!.members.map((m) => m.name)).toEqual(["action", "actor"]);
      expect(s.slots[7]!.actual).toBe(s.abiRecord!.hash);
      expect(s.witness!.hash).toBe(s.abiRecord!.hash);
      expect(s.writtenBy!.hash).toBe(saleHash);
      expect(s.storageWrites.length).toBeGreaterThanOrEqual(8); // all of its slots were written by the sale
      expect(s.storageWrites.every((w) => s.slots.some((x) => x.slot === w.slot))).toBe(true);
    });

    it("404s for an unknown record", async () => {
      expect((await h.get("/api/storage/records/99")).status).toBe(404);
    });
  });

  describe("after someone edits contract storage", () => {
    it("the storage view shows the edit before the index has rescanned", async () => {
      await tamper(h, 1, "price", 777n);
      const s = StorageRecordSchema.parse((await h.get("/api/storage/records/1")).body);
      const price = s.slots[5]!;
      expect(price.match).toBe(false);
      expect(BigInt(price.actual)).toBe(777n);
      expect(s.slots.filter((x) => !x.match)).toHaveLength(1);
      expect(s.abiRecord!.price).toBe("777"); // getRecord(1) already returns the edited value
    });

    it("/api/verify shows the contract and the engine agreeing once rescanned (level 1)", async () => {
      await h.indexer.rescanStorage();
      const v = VerifySchema.parse((await h.get("/api/verify")).body);
      expect(v.offChain).toMatchObject({ valid: false, firstBrokenAt: "1", brokenIndexes: ["1"] });
      expect(v.onChain).toMatchObject({ valid: false, brokenAt: "1", audit: { brokenIndexes: ["1"], reasons: [1] } });
      expect(v.comparison).toMatchObject({ agree: true, contractFooled: false });

      const r = RecordDetailSchema.parse((await h.get("/api/records/1")).body);
      expect(r.check).toMatchObject({ status: "dataTampered", dataOk: false, linkOk: true, reasonMask: 1 });
      expect(r.hashSteps.hash).not.toBe(r.hash); // recomputing from the edited fields gives a different hash
      expect(r.check.recomputedHash).toBe(r.hashSteps.hash);
    });

    it("/api/verify says the contract is fooled by a consistent rewrite (level 3)", async () => {
      const rows = [1, 2, 3].map((i) => ({ ...rowToRecord(h.repo.getRecord(i)!) }));
      for (let i = 0; i < rows.length; i++) {
        if (i > 0) rows[i]!.prevHash = rows[i - 1]!.hash;
        rows[i]!.hash = computeHash(rows[i]!);
        await tamper(h, Number(rows[i]!.index), "prevHash", BigInt(rows[i]!.prevHash));
        await tamper(h, Number(rows[i]!.index), "hash", BigInt(rows[i]!.hash));
      }
      await h.indexer.rescanStorage();

      const v = VerifySchema.parse((await h.get("/api/verify")).body);
      expect(v.onChain!.valid).toBe(true);
      expect(v.offChain).toMatchObject({ valid: false, firstBrokenAt: "1", firstBrokenOnChainAt: null });
      expect(v.comparison).toMatchObject({ agree: true, contractFooled: true });
      expect(v.comparison!.notes[0]).toContain("self-consistent rewrite");
    });
  });
});
