import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract } from "ethers";
import { canTransition, isFinal, TRANSITIONS } from "../src/lifecycle/txStateMachine";
import { buildStages } from "../src/lifecycle/stages";
import type { RecordRow, TxRow } from "../src/db/repo";
import { startHarness, eth, type Harness } from "./helpers";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const baseTx = (over: Partial<TxRow> = {}): TxRow => ({
  hash: H(1), blockNumber: 3, txIndex: 0, from: "0xabc", to: "0xdef", nonce: 4, value: "0", gasLimit: "300000",
  maxFee: "3", maxPriorityFee: "1", input: "0x", functionName: "buy", args: null, status: 1, gasUsed: "250000",
  effectiveGasPrice: "2", revertData: null, revertName: null, revertArgs: null, revertApprox: false,
  lifecycleState: "mined", replacedBy: null, firstSeenAt: 1000, minedAt: 2000, ...over,
});
const baseRecord = { index: 7n, hash: H(9), prevHash: H(8) } as RecordRow;

describe("state machine", () => {
  it("only lets a pending transaction move on, and only to a final state", () => {
    expect(TRANSITIONS.pending).toEqual(["mined", "failed", "replaced", "dropped"]);
    for (const s of ["mined", "failed", "replaced", "dropped"] as const) {
      expect(isFinal(s)).toBe(true);
      expect(canTransition(s, "pending")).toBe(false);
      expect(canTransition(s, s)).toBe(true);
    }
    expect(isFinal("pending")).toBe(false);
    expect(canTransition("mined", "dropped")).toBe(false);
  });
});

describe("stages", () => {
  const keys = (s: ReturnType<typeof buildStages>) => s.map((x) => x.key);

  it("pending: shows the stage still ahead", () => {
    const s = buildStages(baseTx({ lifecycleState: "pending", status: null, blockNumber: null, minedAt: null }), null);
    expect(keys(s)).toEqual(["pending", "mined"]);
    expect(s[0]).toMatchObject({ done: true, current: true });
    expect(s[1]).toMatchObject({ done: false, current: false, at: null });
  });

  it("mined with a record: pending → mined → recorded → verified", () => {
    const s = buildStages(baseTx(), baseRecord, { status: "intact" } as never);
    expect(keys(s)).toEqual(["pending", "mined", "recorded", "verified"]);
    expect(s.at(-1)).toMatchObject({ done: true, current: true, label: "Record verified" });
    expect(s[2]!.detail).toMatchObject({ index: "7", hash: H(9) });
    expect(s[1]!.detail).toMatchObject({ block: "3", status: "1" });
  });

  it("flags a record that failed verification", () => {
    const s = buildStages(baseTx(), baseRecord, { status: "dataTampered" } as never);
    expect(s.at(-1)!.label).toBe("Record failed verification");
  });

  it("mined without a record (e.g. withdraw) has no recorded/verified stages", () => {
    expect(keys(buildStages(baseTx({ functionName: "withdraw" }), null))).toEqual(["pending", "mined"]);
  });

  it("failed: pending → mined (reverted) → explained, with nothing recorded", () => {
    const s = buildStages(baseTx({ status: 0, lifecycleState: "failed", revertName: "NotListed" }), null);
    expect(keys(s)).toEqual(["pending", "mined", "explained"]);
    expect(s[1]!.label).toBe("Mined (reverted)");
    expect(s[2]!.detail.error).toBe("NotListed");
  });

  it("replaced and dropped end the story without being mined", () => {
    const r = buildStages(baseTx({ lifecycleState: "replaced", replacedBy: H(2), status: null, blockNumber: null }), null);
    expect(keys(r)).toEqual(["pending", "replaced"]);
    expect(r[1]!.detail.replacedBy).toBe(H(2));
    expect(keys(buildStages(baseTx({ lifecycleState: "dropped", status: null, blockNumber: null }), null))).toEqual(["pending", "dropped"]);
  });
});

describe("mempool watcher on a real node", () => {
  let h: Harness;
  const send = (signer: number, fn: string, args: unknown[], overrides: object = {}) =>
    (h.deployed.market.connect(h.deployed.signers[signer]!) as Contract).getFunction(fn)(...args, overrides);
  const types = () => h.bus.since(0)!.map((m) => m.type);

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.indexer.syncOnce();
    await h.rpc.send("evm_setAutomine", [false]);
  }, 90_000);
  afterAll(async () => {
    await h.rpc.send("evm_setAutomine", [true]).catch(() => undefined);
    await h.stop();
  });

  it("sees a transaction waiting in the pool, decoded, before it is mined", async () => {
    const tx = await send(0, "listForSale", [1, eth("1")]);
    const report = await h.watcher.poll();
    expect(report.seenPending).toEqual([tx.hash]);

    const row = h.repo.getTx(tx.hash)!;
    expect(row).toMatchObject({ lifecycleState: "pending", functionName: "listForSale", blockNumber: null, status: null });
    expect(row.args).toEqual({ productId: "1", price: eth("1").toString() });
    expect(types()).toContain("tx.pending");

    // polling again does not report it twice
    expect((await h.watcher.poll()).seenPending).toEqual([]);
  });

  it("turns the same row into a mined transaction, keeping when it was first seen", async () => {
    const pending = h.repo.listTxs({ state: "pending" })[0]!;
    await new Promise((r) => setTimeout(r, 20));
    await h.rpc.send("evm_mine");
    await h.indexer.syncOnce();
    await h.watcher.poll();

    const mined = h.repo.getTx(pending.hash)!;
    expect(mined.lifecycleState).toBe("mined");
    expect(mined.blockNumber).not.toBeNull();
    expect(mined.firstSeenAt).toBe(pending.firstSeenAt);
    expect(mined.minedAt!).toBeGreaterThan(mined.firstSeenAt);
    expect(h.repo.listTxs({ state: "pending" })).toEqual([]);
    const stages = buildStages(mined, h.repo.recordForTx(mined.hash), h.verification.get().checks[1]);
    expect(stages.map((s) => s.key)).toEqual(["pending", "mined", "recorded", "verified"]);
  });

  it("marks a pending transaction replaced when a higher-fee one takes its nonce", async () => {
    const nonce = await h.node.provider.getTransactionCount(h.deployment.roles[1]!.address, "pending");
    const original = await send(1, "registerProduct", ["Original"], { nonce, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    await h.watcher.poll();
    expect(h.repo.getTx(original.hash)!.lifecycleState).toBe("pending");

    const replacement = await h.deployed.signers[1]!.sendTransaction({
      to: h.deployment.roles[1]!.address, value: 0, nonce, maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n,
    });
    const report = await h.watcher.poll();
    expect(report.replaced).toEqual([original.hash]);
    expect(h.repo.getTx(original.hash)).toMatchObject({ lifecycleState: "replaced", replacedBy: replacement.hash });
    expect(types()).toContain("tx.replaced");

    const before = h.repo.recordCount();
    await h.rpc.send("evm_mine");
    await h.indexer.syncOnce();
    await h.watcher.poll();

    // the replacement was mined, the original never was, and it added no ledger record
    expect(h.repo.getTx(replacement.hash)!.lifecycleState).toBe("mined");
    expect(h.repo.getTx(original.hash)).toMatchObject({ lifecycleState: "replaced", blockNumber: null });
    expect(h.repo.recordCount()).toBe(before);
    expect(h.repo.getProduct(2)).toBeNull(); // "Original" was never registered
  });

  it("does not call a transaction 'dropped' when its replacement was mined but not indexed yet", async () => {
    const nonce = await h.node.provider.getTransactionCount(h.deployment.roles[2]!.address, "pending");
    const original = await send(2, "registerProduct", ["Race"], { nonce, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    await h.watcher.poll();
    await h.deployed.signers[2]!.sendTransaction({
      to: h.deployment.roles[2]!.address, value: 0, nonce, maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n,
    });
    // do NOT poll: another poll could mark it replaced via the pool; here the block is mined first
    await h.rpc.send("evm_mine");

    await h.watcher.poll(); // the original left the pool, but the new block is not indexed
    expect(h.repo.getTx(original.hash)!.lifecycleState).toBe("pending"); // not wrongly "dropped"

    await h.indexer.syncOnce(); // ingesting the block settles it
    expect(h.repo.getTx(original.hash)!.lifecycleState).toBe("replaced");
  });

  it("marks a transaction dropped when it is removed from the pool", async () => {
    const tx = await send(3, "registerProduct", ["Dropped"]);
    await h.watcher.poll();
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("pending");

    expect(await h.rpc.send("hardhat_dropTransaction", [tx.hash])).toBe(true);
    const report = await h.watcher.poll();
    expect(report.dropped).toEqual([tx.hash]);
    expect(h.repo.getTx(tx.hash)).toMatchObject({ lifecycleState: "dropped", blockNumber: null });
    expect(types()).toContain("tx.dropped");

    await h.rpc.send("evm_mine");
    await h.indexer.syncOnce();
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("dropped");
    expect(h.repo.getProduct(2)).toBeNull();
  });

  it("markDropped is a no-op for transactions that are no longer pending", async () => {
    const mined = h.repo.listTxs({ state: "mined", limit: 1 })[0]!;
    h.watcher.markDropped(mined.hash);
    expect(h.repo.getTx(mined.hash)!.lifecycleState).toBe("mined");
    h.watcher.markDropped(H(12345)); // unknown hash
  });

  it("lets pending transactions queue up and mines them together in one block", async () => {
    const a = await send(0, "registerProduct", ["A"]);
    const b = await send(1, "registerProduct", ["B"]);
    await h.watcher.poll();
    expect(h.repo.listTxs({ state: "pending" }).map((t) => t.hash).sort()).toEqual([a.hash, b.hash].sort());

    await h.rpc.send("evm_mine");
    await h.indexer.syncOnce();
    const ta = h.repo.getTx(a.hash)!, tb = h.repo.getTx(b.hash)!;
    expect(ta.blockNumber).toBe(tb.blockNumber);
    expect(ta.lifecycleState).toBe("mined");
    expect(tb.lifecycleState).toBe("mined");
    expect(h.verification.summary().valid).toBe(true);
  });

  it("keeps a failed transaction's explanation in its stages", async () => {
    const tx = await send(4, "listForSale", [1, eth("1")], { gasLimit: 300_000 }); // outsider: will revert
    await h.watcher.poll();
    await h.rpc.send("evm_mine");
    await h.indexer.syncOnce();
    const row = h.repo.getTx(tx.hash)!;
    expect(row.lifecycleState).toBe("failed");
    const stages = buildStages(row, null);
    expect(stages.map((s) => s.key)).toEqual(["pending", "mined", "explained"]);
    expect(stages[2]!.detail.error).toBe("NotProductOwner");
  });
});
