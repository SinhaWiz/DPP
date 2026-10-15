import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Repo, type RecordRow, type TxRow } from "../src/db/repo";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const tx = (over: Partial<TxRow> = {}): TxRow => ({
  hash: H(1), blockNumber: 2, txIndex: 0, from: A, to: A, nonce: 0, value: "0", gasLimit: "300000",
  maxFee: "3000000000", maxPriorityFee: "1000000000", input: "0x", functionName: "registerProduct",
  args: { name: "Laptop" }, status: 1, gasUsed: "250000", effectiveGasPrice: "2000000000", revertData: null,
  revertName: null, revertArgs: null, revertApprox: false, lifecycleState: "mined", replacedBy: null,
  firstSeenAt: 1000, minedAt: 2000, ...over,
});

const rec = (i: number, over: Partial<RecordRow> = {}): RecordRow => ({
  index: BigInt(i), productId: 1n, action: 0, actor: A, counterparty: "0x" + "00".repeat(20), price: 10n ** 18n * 5n,
  timestamp: 1700000000n + BigInt(i), prevHash: H(i), hash: H(i + 1), txHash: H(100 + i), blockNumber: i + 1,
  eventProductId: 1n, eventAction: 0, eventActor: A, eventPrevHash: H(i), eventHash: H(i + 1), ...over,
});

describe("Repo", () => {
  let repo: Repo;
  beforeEach(() => { repo = Repo.open(":memory:"); });
  afterEach(() => { repo.close(); });

  it("stores meta and sets the schema version", () => {
    expect(repo.getMeta("schema_version")).toBe("1");
    repo.setMeta("session", "abc");
    repo.setMeta("session", "def");
    expect(repo.getMeta("session")).toBe("def");
    expect(repo.getMeta("missing")).toBeNull();
  });

  it("round-trips blocks and finds the latest", () => {
    repo.upsertBlock({ number: 1, hash: H(1), parentHash: H(0), timestamp: 10, txCount: 1 });
    repo.upsertBlock({ number: 2, hash: H(2), parentHash: H(1), timestamp: 20, txCount: 0 });
    repo.upsertBlock({ number: 2, hash: H(22), parentHash: H(1), timestamp: 21, txCount: 3 }); // upsert replaces
    expect(repo.latestBlock()).toEqual({ number: 2, hash: H(22), parentHash: H(1), timestamp: 21, txCount: 3 });
    expect(repo.listBlocks(1, 2).map((b) => b.number)).toEqual([1, 2]);
    expect(repo.getBlock(9)).toBeNull();
  });

  it("round-trips a transaction including args and revert info", () => {
    const failed = tx({
      hash: H(2), status: 0, lifecycleState: "failed", revertData: "0x92691cab", revertName: "ProductNotFound",
      revertArgs: { productId: "99" }, revertApprox: true,
    });
    repo.upsertTx(tx());
    repo.upsertTx(failed);
    expect(repo.getTx(H(1))).toEqual(tx());
    expect(repo.getTx(H(2))).toEqual(failed);
    expect(repo.getTx(H(3))).toBeNull();
  });

  it("keeps the earliest first_seen_at when a pending tx is later mined", () => {
    repo.upsertTx(tx({ blockNumber: null, txIndex: null, status: null, lifecycleState: "pending", firstSeenAt: 500, minedAt: null }));
    repo.upsertTx(tx({ firstSeenAt: 900 }));
    const t = repo.getTx(H(1))!;
    expect(t.firstSeenAt).toBe(500);
    expect(t.lifecycleState).toBe("mined");
    expect(t.blockNumber).toBe(2);
  });

  it("lists transactions newest first with filters, pending first", () => {
    repo.upsertTx(tx({ hash: H(1), blockNumber: 1 }));
    repo.upsertTx(tx({ hash: H(2), blockNumber: 3, status: 0, lifecycleState: "failed" }));
    repo.upsertTx(tx({ hash: H(3), blockNumber: null, txIndex: null, status: null, lifecycleState: "pending", nonce: 5 }));
    expect(repo.listTxs().map((t) => t.hash)).toEqual([H(3), H(2), H(1)]);
    expect(repo.listTxs({ state: "failed" }).map((t) => t.hash)).toEqual([H(2)]);
    expect(repo.listTxs({ state: ["failed", "pending"] })).toHaveLength(2);
    expect(repo.listTxs({ from: A.toLowerCase(), limit: 1 })).toHaveLength(1);
    expect(repo.countTxs("mined")).toBe(1);
    expect(repo.countTxs()).toBe(3);
  });

  it("finds pending transactions with the same sender and nonce", () => {
    repo.upsertTx(tx({ hash: H(1), blockNumber: null, txIndex: null, status: null, lifecycleState: "pending", nonce: 7 }));
    repo.upsertTx(tx({ hash: H(2), blockNumber: null, txIndex: null, status: null, lifecycleState: "pending", nonce: 8 }));
    expect(repo.findPendingBySenderNonce(A, 7, H(9)).map((t) => t.hash)).toEqual([H(1)]);
    expect(repo.findPendingBySenderNonce(A, 7, H(1))).toEqual([]);
  });

  it("stores events idempotently", () => {
    const e = { txHash: H(1), logIndex: 0, blockNumber: 2, address: A, name: "RecordAppended", args: { index: "0", hash: H(5) } };
    repo.insertEvent(e);
    repo.insertEvent(e);
    expect(repo.eventsForTx(H(1))).toEqual([e]);
    expect(repo.eventsByName("RecordAppended")).toHaveLength(1);
    expect(repo.eventsInBlocks(0, 1)).toHaveLength(0);
  });

  it("round-trips records with bigint prices far above 2^53 and the witness columns", () => {
    const r = rec(0, { price: 123456789012345678901234567890n });
    repo.upsertRecord(r);
    expect(repo.getRecord(0)).toEqual(r);
    expect(repo.getRecord(0n)).toEqual(r);
    repo.upsertRecord(rec(1, { productId: 2n }));
    repo.upsertRecord(rec(2, { actor: "0xABCDEF0000000000000000000000000000000001" }));
    expect(repo.recordCount()).toBe(3);
    expect(repo.allRecords().map((x) => x.index)).toEqual([0n, 1n, 2n]);
    expect(repo.listRecords({ productId: 2n }).map((x) => x.index)).toEqual([1n]);
    expect(repo.listRecords({ actor: "0xabcdef0000000000000000000000000000000001" })).toHaveLength(1);
    expect(repo.listRecords({ offset: 1, limit: 1 }).map((x) => x.index)).toEqual([1n]);
    expect(repo.recordForTx(H(101))!.index).toBe(1n);
  });

  it("orders records numerically, not as text (10 after 9)", () => {
    for (const i of [10, 2, 9, 1]) repo.upsertRecord(rec(i));
    expect(repo.allRecords().map((r) => r.index)).toEqual([1n, 2n, 9n, 10n]);
  });

  it("updates a record's stored values without losing its event witness", () => {
    repo.upsertRecord(rec(0));
    repo.upsertRecord(rec(0, { price: 999n, hash: H(77), eventHash: H(1) }));
    const r = repo.getRecord(0)!;
    expect(r.price).toBe(999n);
    expect(r.hash).toBe(H(77));
    expect(r.eventHash).toBe(H(1));
  });

  it("round-trips products with and without a reservation", () => {
    const plain = { id: 1n, name: "Laptop", owner: A, price: 0n, reservedBy: null, reservedAmount: null, reservedExpires: null, updatedBlock: 3 };
    const reserved = { ...plain, id: 2n, price: 10n ** 18n, reservedBy: A, reservedAmount: 10n ** 18n, reservedExpires: 1800000000n };
    repo.upsertProduct(plain);
    repo.upsertProduct(reserved);
    repo.upsertProduct({ ...plain, owner: "0x1" });
    expect(repo.getProduct(2)).toEqual(reserved);
    expect(repo.getProduct(1)!.owner).toBe("0x1");
    expect(repo.listProducts().map((p) => p.id)).toEqual([1n, 2n]);
    expect(repo.productCount()).toBe(2);
  });

  it("replaces storage writes for a transaction", () => {
    const rows = [{ seq: 0, slot: H(1), before: H(0), after: H(5), gasCost: 22100 }, { seq: 1, slot: H(2), before: H(1), after: H(2), gasCost: null }];
    repo.replaceStorageWrites(H(1), rows);
    repo.replaceStorageWrites(H(1), rows.slice(0, 1));
    expect(repo.storageWritesForTx(H(1))).toEqual([{ txHash: H(1), ...rows[0] }]);
  });

  it("journals tampering and undoes by group", () => {
    const base = { groupId: "g1", recordIndex: 3n, field: "price", slot: H(9), oldValue: H(1), newValue: H(2), mode: "data", createdAt: 1 };
    repo.addTamper(base);
    repo.addTamper({ ...base, field: "hash" });
    repo.addTamper({ ...base, groupId: "g2" });
    expect(repo.tamperGroup("g1").map((t) => t.field)).toEqual(["price", "hash"]);
    expect(repo.activeTamperGroups()).toEqual(["g1", "g2"]);
    repo.markTamperUndone("g1", 99);
    expect(repo.activeTamperGroups()).toEqual(["g2"]);
    expect(repo.tamperGroup("g1")[0]!.undoneAt).toBe(99);
  });

  it("rewinds to a block, deleting everything after it but keeping pending transactions", () => {
    for (const n of [1, 2, 3]) {
      repo.upsertBlock({ number: n, hash: H(n), parentHash: H(n - 1), timestamp: n, txCount: 1 });
      repo.upsertTx(tx({ hash: H(n), blockNumber: n }));
      repo.insertEvent({ txHash: H(n), logIndex: 0, blockNumber: n, address: A, name: "E", args: {} });
      repo.upsertRecord(rec(n - 1, { blockNumber: n, txHash: H(n) }));
      repo.replaceStorageWrites(H(n), [{ seq: 0, slot: H(1), before: H(0), after: H(1), gasCost: 1 }]);
    }
    repo.upsertTx(tx({ hash: H(50), blockNumber: null, txIndex: null, status: null, lifecycleState: "pending", nonce: 9 }));

    repo.rewindTo(1);

    expect(repo.latestBlock()!.number).toBe(1);
    expect(repo.getTx(H(1))).not.toBeNull();
    expect(repo.getTx(H(2))).toBeNull();
    expect(repo.getTx(H(50))).not.toBeNull();
    expect(repo.recordCount()).toBe(1);
    expect(repo.eventsInBlocks(0, 10)).toHaveLength(1);
    expect(repo.storageWritesForTx(H(3))).toEqual([]);
  });

  it("wipes everything but keeps the schema version", () => {
    repo.setMeta("session_id", "x");
    repo.upsertRecord(rec(0));
    repo.wipe();
    expect(repo.recordCount()).toBe(0);
    expect(repo.getMeta("session_id")).toBeNull();
    expect(repo.getMeta("schema_version")).toBe("1");
  });

  it("joins nested transactions, rolling everything back if the outer one fails", () => {
    expect(() =>
      repo.transaction(() => {
        repo.upsertRecord(rec(0));
        repo.replaceStorageWrites(H(1), [{ seq: 0, slot: H(1), before: H(0), after: H(1), gasCost: 1 }]); // has its own transaction
        throw new Error("outer failed");
      }),
    ).toThrow("outer failed");
    expect(repo.recordCount()).toBe(0);
    expect(repo.storageWritesForTx(H(1))).toEqual([]);
    // and the repository is still usable afterwards
    repo.transaction(() => repo.upsertRecord(rec(0)));
    expect(repo.recordCount()).toBe(1);
  });

  it("rolls back a failed transaction", () => {
    expect(() => repo.transaction(() => { repo.upsertRecord(rec(0)); throw new Error("nope"); })).toThrow("nope");
    expect(repo.recordCount()).toBe(0);
  });
});

describe("Repo on disk", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "repo-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("creates missing folders and persists across reopen", () => {
    const path = join(dir, "nested", "deep", "index.sqlite");
    const a = Repo.open(path);
    a.upsertRecord(rec(0));
    a.setMeta("k", "v");
    a.close();
    const b = Repo.open(path);
    expect(b.recordCount()).toBe(1);
    expect(b.getMeta("k")).toBe("v");
    b.close();
  });

  it("refuses a database with an unknown schema version", () => {
    const path = join(dir, "i.sqlite");
    const a = Repo.open(path);
    a.setMeta("schema_version", "99");
    a.close();
    expect(() => Repo.open(path)).toThrow(/schema version 99/);
  });
});
