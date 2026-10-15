import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract } from "ethers";
import { Action, computeHash, toLedgerRecord, verifyRecords } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { rowToRecord } from "../src/verification";

describe("indexer: ledger records, witnesses, products and verification", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  const chainRecords = async () =>
    ((await (h.deployed.market as Contract).getFunction("getRecords")(0, 1000)) as never[]).map(toLedgerRecord);

  it("starts empty and valid", async () => {
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(0);
    expect(h.verification.summary()).toMatchObject({ valid: true, recordCount: 0, firstBrokenAt: null });
  });

  it("copies every record from contract storage and pairs it with its event", async () => {
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    await h.indexer.syncOnce();

    const onChain = await chainRecords();
    const rows = h.repo.allRecords();
    expect(rows).toHaveLength(3);
    rows.forEach((row, i) => {
      expect(rowToRecord(row)).toEqual(onChain[i]);
      expect(computeHash(rowToRecord(row))).toBe(row.hash);
      // the witness copied from the RecordAppended event agrees with storage
      expect(row.eventHash).toBe(row.hash);
      expect(row.eventPrevHash).toBe(row.prevHash);
      expect(row.eventActor).toBe(row.actor);
      expect(row.eventAction).toBe(row.action);
      expect(row.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  it("links each record to the transaction and block that created it", async () => {
    const sale = h.repo.getRecord(2)!;
    const tx = h.repo.getTx(sale.txHash!)!;
    expect(tx.functionName).toBe("buy");
    expect(tx.blockNumber).toBe(sale.blockNumber);
    expect(h.repo.recordForTx(tx.hash)!.index).toBe(2n);
    expect(sale.action).toBe(Action.Sold);
  });

  it("verifies the indexed ledger as intact, agreeing with the contract", async () => {
    const summary = h.verification.summary();
    expect(summary).toMatchObject({ valid: true, recordCount: 3, brokenIndexes: [] });
    const reader = (h.indexer as unknown as { reader: { onChainVerdict: () => Promise<{ valid: boolean }> } }).reader;
    expect((await reader.onChainVerdict()).valid).toBe(true);
  });

  it("indexes products and updates the owner after a sale", async () => {
    const p = h.repo.getProduct(1)!;
    expect(p.name).toBe("Laptop");
    expect(p.owner.toLowerCase()).toBe(h.deployment.roles[1]!.address.toLowerCase());
    expect(p.price).toBe(0n);
    expect(p.reservedBy).toBeNull();
  });

  it("tracks a reservation on a product and clears it when revoked", async () => {
    await h.call(0, "registerProduct", "Phone");
    await h.call(0, "listForSale", 2, eth("2"));
    await h.call(2, "reserve", 2, { value: eth("2") });
    await h.indexer.syncOnce();

    let p = h.repo.getProduct(2)!;
    expect(p.reservedBy!.toLowerCase()).toBe(h.deployment.roles[2]!.address.toLowerCase());
    expect(p.reservedAmount).toBe(eth("2"));
    expect(p.reservedExpires).toBeGreaterThan(0n);
    expect(h.repo.recordCount()).toBe(6);
    expect(h.repo.getRecord(5)!.action).toBe(Action.Reserved);

    await h.call(2, "revokeReservation", 2);
    await h.indexer.syncOnce();
    p = h.repo.getProduct(2)!;
    expect(p.reservedBy).toBeNull();
    expect(h.repo.getRecord(6)!.action).toBe(Action.Revoked);
    expect(h.verification.summary().valid).toBe(true);
  });

  it("publishes record.appended and verification messages", async () => {
    const seen: string[] = [];
    h.bus.subscribe((m) => seen.push(m.type));
    await h.call(0, "registerProduct", "Tablet");
    await h.indexer.syncOnce();
    expect(seen).toContain("record.appended");
    const msg = h.bus.since(0)!.filter((m) => m.type === "record.appended").at(-1)!;
    expect(msg.data).toMatchObject({ index: "7", productId: "3", action: Action.Registered });
  });

  it("does not republish an unchanged verification verdict", async () => {
    const before = h.bus.since(0)!.filter((m) => m.type === "verification.changed").length;
    await h.indexer.syncOnce();
    await h.indexer.syncOnce();
    expect(h.bus.since(0)!.filter((m) => m.type === "verification.changed").length).toBe(before);
  });

  it("gives the same verdict incrementally as a from-scratch run", async () => {
    const full = verifyRecords(h.repo.allRecords().map(rowToRecord));
    expect(full.valid).toBe(true);
    expect(h.verification.get().checks.length).toBe(full.checks.length);
  });

  it("failed transactions add no records", async () => {
    const before = h.repo.recordCount();
    await h.callFailing(4, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(before);
  });

  it("indexes more than one page of records", async () => {
    // 40 products × 2 records = 80 records, which spans two pages of 50
    for (let i = 0; i < 40; i++) {
      await h.call(0, "registerProduct", `Bulk ${i}`);
      await h.call(0, "listForSale", 4 + i, eth("0.01"));
    }
    await h.indexer.syncOnce();
    const total = Number(await (h.deployed.market as Contract).getFunction("ledgerLength")());
    expect(h.repo.recordCount()).toBe(total);
    expect(total).toBeGreaterThan(50);
    expect(h.verification.summary().valid).toBe(true);
    expect(h.repo.productCount()).toBe(43);
  }, 120_000);
});
