import { describe, expect, it } from "vitest";
import { computeHash, type ApiRecord, type LedgerRecord } from "@dpp/shared";
import fixture from "../../../packages/shared/test/fixtures/records.json";
import { apiToLedgerRecord, compareWithServer, verifyInBrowser } from "./verifyInBrowser";
import { toLedgerRecord } from "@dpp/shared";

const ZERO = "0x" + "00".repeat(20);
/** Builds the API's view of the real fixture records, as the server would send them. */
function apiRecords(): ApiRecord[] {
  return fixture.records.map((r) => ({
    index: r.index, productId: r.productId, productName: null, action: r.action, actionLabel: "x", actor: r.actor,
    counterparty: r.counterparty ?? ZERO, price: r.price, timestamp: r.timestamp, prevHash: r.prevHash, hash: r.hash,
    txHash: null, blockNumber: null,
    check: { dataOk: true, linkOk: true, anchorOk: true, status: "intact", onChainStatus: "intact", reasonMask: 0, reasons: [], recomputedHash: r.hash, expectedPrevHash: null },
    witness: { productId: r.productId, action: r.action, actor: r.actor, prevHash: r.prevHash, hash: r.hash },
  })) as ApiRecord[];
}

describe("verifyInBrowser", () => {
  it("accepts a real, untouched ledger", () => {
    const result = verifyInBrowser(apiRecords());
    expect(result.valid).toBe(true);
    expect(result.checks).toHaveLength(fixture.records.length);
  });

  it("converts API strings back to bigints exactly", () => {
    const r = apiToLedgerRecord(apiRecords()[3]!);
    expect(typeof r.index).toBe("bigint");
    expect(r.price.toString()).toBe(fixture.records[3]!.price);
  });

  it("catches a data edit even when the server claims everything is intact", () => {
    const recs = apiRecords();
    recs[4]!.price = (BigInt(recs[4]!.price) + 1n).toString();
    const local = verifyInBrowser(recs);
    expect(local.firstBrokenAt).toBe(4n);
    expect(local.checks[4]!.status).toBe("dataTampered");

    // the server (here: lying) said intact for every record
    const cmp = compareWithServer(local, recs);
    expect(cmp.agree).toBe(false);
    expect(cmp.diffs).toEqual([{ index: "4", browser: "dataTampered", server: "intact" }]);
  });

  it("catches a self-consistent rewrite through the event-log witnesses", () => {
    const recs = apiRecords();
    const ledger: LedgerRecord[] = recs.map(apiToLedgerRecord);
    ledger[2]!.price += 5n;
    for (let i = 2; i < ledger.length; i++) {
      if (i > 2) ledger[i]!.prevHash = ledger[i - 1]!.hash;
      ledger[i]!.hash = computeHash(ledger[i]!);
      recs[i]!.price = ledger[i]!.price.toString();
      recs[i]!.prevHash = ledger[i]!.prevHash;
      recs[i]!.hash = ledger[i]!.hash;
    }
    const local = verifyInBrowser(recs);
    expect(local.firstBrokenOnChainAt).toBeNull(); // nothing inside the chain looks wrong
    expect(local.firstBrokenAt).toBe(2n);          // but the witnesses disagree
    expect(local.checks[2]!.status).toBe("anchorMismatch");
  });

  it("agrees with an honest server", () => {
    const recs = apiRecords();
    recs[4]!.price = (BigInt(recs[4]!.price) + 1n).toString();
    const local = verifyInBrowser(recs);
    recs[4]!.check = { ...recs[4]!.check, status: "dataTampered" };
    expect(compareWithServer(local, recs)).toEqual({ agree: true, diffs: [] });
  });

  it("works with no event witnesses (anchor unknown, not failed)", () => {
    const recs = apiRecords().map((r) => ({ ...r, witness: null }));
    const local = verifyInBrowser(recs);
    expect(local.valid).toBe(true);
    expect(local.checks.every((c) => c.anchorOk === null)).toBe(true);
    expect(toLedgerRecord).toBeDefined();
  });

  it("handles an empty ledger", () => {
    expect(verifyInBrowser([])).toMatchObject({ valid: true, checks: [] });
  });
});
