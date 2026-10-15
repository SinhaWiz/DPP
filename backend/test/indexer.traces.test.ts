import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract } from "ethers";
import { ledgerLengthSlot, recordSlot, word } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { TraceReader } from "../src/indexer/traceReader";
import type { Rpc } from "../src/chain/rpc";

describe("indexer: failed transactions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  const failed = async (signer: number, fn: string, ...args: unknown[]) => {
    const hash = await h.callFailing(signer, fn, ...args);
    await h.indexer.syncOnce();
    return h.repo.getTx(hash)!;
  };

  it("decodes the exact custom error from the trace, with its arguments", async () => {
    const t = await failed(4, "listForSale", 1, eth("2"));
    expect(t.lifecycleState).toBe("failed");
    expect(t.revertName).toBe("NotProductOwner");
    expect(t.revertArgs).toEqual({ productId: "1", caller: h.deployment.roles[4]!.address });
    expect(t.revertData!.startsWith("0x")).toBe(true);
    expect(t.revertApprox).toBe(false);
  });

  it("decodes errors that carry amounts", async () => {
    const t = await failed(2, "buy", 1, { value: eth("0.5") });
    expect(t.revertName).toBe("IncorrectPayment");
    expect(t.revertArgs).toEqual({ expected: eth("1").toString(), sent: eth("0.5").toString() });
  });

  it("decodes errors without arguments, and unknown products", async () => {
    expect((await failed(4, "registerProduct", "")).revertName).toBe("EmptyName");
    const missing = await failed(2, "buy", 99, { value: eth("1") });
    expect(missing.revertName).toBe("ProductNotFound");
    expect(missing.revertArgs).toEqual({ productId: "99" });
  });

  it("explains a failure that happened one contract deeper (through the rejecter)", async () => {
    await h.call(1, "registerProduct", "Phone"); // product 2, so the rejecter has something to withdraw from
    const rejecter = h.deployed.rejecter.connect(h.deployed.signers[0]!) as Contract;
    const tx = await rejecter.getFunction("withdrawFrom")(await h.deployed.market.getAddress(), { gasLimit: 400_000 });
    await tx.wait().catch(() => undefined);
    await h.indexer.syncOnce();
    const t = h.repo.getTx(tx.hash)!;
    expect(t.functionName).toBe("withdrawFrom");
    expect(t.revertName).toBe("NothingToWithdraw"); // the rejecter has no balance, and the error bubbles up
  });

  it("records no ledger records, events or storage writes for a failed transaction", async () => {
    const t = await failed(4, "listForSale", 1, eth("3"));
    expect(h.repo.eventsForTx(t.hash)).toEqual([]);
    expect(h.repo.storageWritesForTx(t.hash)).toEqual([]);
    expect(h.repo.recordForTx(t.hash)).toBeNull();
  });
});

describe("indexer: storage writes", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("captures every SSTORE of a registration with before and after values", async () => {
    await h.call(0, "registerProduct", "Laptop");
    await h.indexer.syncOnce();
    const tx = h.repo.listTxs({ limit: 1 })[0]!;
    const writes = h.repo.storageWritesForTx(tx.hash);
    expect(writes.length).toBeGreaterThanOrEqual(10);

    // the ledger length goes 0 → 1
    const length = writes.find((w) => w.slot === word(ledgerLengthSlot()))!;
    expect(BigInt(length.before)).toBe(0n);
    expect(BigInt(length.after)).toBe(1n);

    // record #0's index and hash slots are written from zero
    const hashSlot = writes.find((w) => w.slot === word(recordSlot(0, "hash")))!;
    expect(BigInt(hashSlot.before)).toBe(0n);
    expect(hashSlot.after).toBe(h.repo.getRecord(0)!.hash);
  });

  it("shows the packed action+actor slot being written twice", async () => {
    const tx = h.repo.listTxs({ limit: 1 })[0]!;
    const packed = h.repo.storageWritesForTx(tx.hash).filter((w) => w.slot === word(recordSlot(0, "action")));
    expect(packed).toHaveLength(2);
    // the second write starts from what the first one left
    expect(packed[1]!.before).toBe(packed[0]!.after);
  });

  it("uses gas costs that distinguish a new slot from an update", async () => {
    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
    const tx = h.repo.listTxs({ limit: 1 })[0]!;
    const writes = h.repo.storageWritesForTx(tx.hash);
    const length = writes.find((w) => w.slot === word(ledgerLengthSlot()))!; // 1 → 2, an update
    const newField = writes.find((w) => w.slot === word(recordSlot(1, "hash")))!; // zero → value
    expect(length.gasCost).toBeLessThan(5000);
    expect(newField.gasCost).toBeGreaterThan(20000);
    expect(writes.reduce((n, w) => n + (w.gasCost ?? 0), 0)).toBeGreaterThan(100_000);
  });

  it("chains the 'before' value of a slot to the previous transaction's 'after'", async () => {
    const [second, first] = h.repo.listTxs({ limit: 2 });
    const slot = word(ledgerLengthSlot());
    const a = h.repo.storageWritesForTx(first!.hash).find((w) => w.slot === slot)!;
    const b = h.repo.storageWritesForTx(second!.hash).find((w) => w.slot === slot)!;
    expect(b.before).toBe(a.after);
  });

  it("gets 'before' right when several transactions share one block", async () => {
    await h.rpc.send("evm_setAutomine", [false]);
    try {
      const market = h.deployed.market;
      const t1 = await (market.connect(h.deployed.signers[0]!) as Contract).getFunction("registerProduct")("A");
      const t2 = await (market.connect(h.deployed.signers[1]!) as Contract).getFunction("registerProduct")("B");
      await h.rpc.send("evm_mine");
      await t1.wait(); await t2.wait();
    } finally {
      await h.rpc.send("evm_setAutomine", [true]);
    }
    await h.indexer.syncOnce();

    const [later, earlier] = h.repo.listTxs({ limit: 2 });
    expect(earlier!.blockNumber).toBe(later!.blockNumber);
    const slot = word(ledgerLengthSlot());
    const a = h.repo.storageWritesForTx(earlier!.hash).find((w) => w.slot === slot)!;
    const b = h.repo.storageWritesForTx(later!.hash).find((w) => w.slot === slot)!;
    expect(BigInt(b.before)).toBe(BigInt(a.after));
    expect(BigInt(b.after)).toBe(BigInt(a.after) + 1n);
  });

  it("skips storage tracing when disabled", async () => {
    const off = await startHarness({ traceStorage: false });
    try {
      await off.call(0, "registerProduct", "Laptop");
      await off.indexer.syncOnce();
      expect(off.repo.storageWritesForTx(off.repo.listTxs({ limit: 1 })[0]!.hash)).toEqual([]);
    } finally {
      await off.stop();
    }
  });
});

describe("TraceReader fallback", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  /** An RPC whose node has no debug_* methods, like most hosted providers. */
  const noDebug = (rpc: Rpc): Rpc => ({
    ...rpc,
    send: (method, params) =>
      method.startsWith("debug_") ? Promise.reject(new Error(`the method ${method} does not exist/is not available`)) : rpc.send(method, params),
  });

  it("falls back to replaying the call and flags the result as approximate", async () => {
    const hash = await h.callFailing(4, "listForSale", 1, eth("1"));
    const raw = await h.rpc.send<never>("eth_getTransactionByHash", [hash]);
    const reader = new TraceReader(noDebug(h.rpc));
    const block = Number((raw as { blockNumber: string }).blockNumber);

    const info = await reader.revertFor(raw, block);
    expect(info.approx).toBe(true);
    expect(info.data).toMatch(/^0x[0-9a-f]+$/);
    expect(reader.tracing).toBe(false); // remembered, so it stops asking
    expect(await reader.storageWrites(hash)).toBeNull();
  });

  it("uses the real trace when available", async () => {
    const hash = await h.callFailing(4, "listForSale", 1, eth("1"));
    const raw = await h.rpc.send<never>("eth_getTransactionByHash", [hash]);
    const info = await new TraceReader(h.rpc).revertFor(raw, Number((raw as { blockNumber: string }).blockNumber));
    expect(info.approx).toBe(false);
  });
});
