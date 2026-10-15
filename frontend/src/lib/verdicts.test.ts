import { describe, expect, it } from "vitest";
import { computeHash, verifyRecords, type ApiVerify, type EventWitness, type LedgerRecord } from "@dpp/shared";
import { LEVELS, explainDifferences, levelInfo, verdictRows } from "./verdicts";

const make = (n: number): { records: LedgerRecord[]; witnesses: EventWitness[] } => {
  const records: LedgerRecord[] = [];
  let prev = "0x" + "00".repeat(32);
  for (let i = 0; i < n; i++) {
    const r: LedgerRecord = { index: BigInt(i), timestamp: BigInt(i), productId: 1n, action: 1, actor: "0x" + "11".repeat(20), counterparty: "0x" + "00".repeat(20), price: 10n, prevHash: prev, hash: "" };
    r.hash = computeHash(r);
    prev = r.hash;
    records.push(r);
  }
  const witnesses = records.map((r) => ({ index: r.index, productId: r.productId, action: r.action, actor: r.actor, prevHash: r.prevHash, hash: r.hash }));
  return { records, witnesses };
};
const verify = (onChain: ApiVerify["onChain"]): ApiVerify => ({ offChain: { valid: true, recordCount: 0, firstBrokenAt: null, firstBrokenOnChainAt: null, brokenIndexes: [] }, onChain, comparison: null });
const contractOk: ApiVerify["onChain"] = { valid: true, brokenAt: "0", audit: { brokenIndexes: [], reasons: [] } };

describe("levels", () => {
  it("are four, in order, each with a distinct mode idea and a prediction naming the record", () => {
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(LEVELS.map((l) => l.mode)).toEqual(["data", "data+hash", "rewrite-tail", "data"]);
    expect(levelInfo(2).expect(5)).toContain("#5");
    expect(levelInfo(2).expect(5)).toContain("5→6");
    expect(levelInfo(4).expect(2, 6)).toContain("#6");
    expect(levelInfo(3).lesson).toContain("consistency, not authenticity");
  });
});

describe("verdictRows", () => {
  it("shows three verdicts for an intact chain", () => {
    const { records, witnesses } = make(4);
    const rows = verdictRows(verify(contractOk), verifyRecords(records, { witnesses }));
    expect(rows.map((r) => r.id)).toEqual(["verifyLedger", "auditRange", "browser"]);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("reports the first problem for verifyLedger and all of them for the others", () => {
    const { records, witnesses } = make(6);
    records[2] = { ...records[2]!, price: 99n };
    records[4] = { ...records[4]!, price: 99n };
    const rows = verdictRows(verify({ valid: false, brokenAt: "2", audit: { brokenIndexes: ["2", "4"], reasons: [1, 1] } }), verifyRecords(records, { witnesses }));
    expect(rows[0]!.summary).toBe("invalid; first problem at record #2");
    expect(rows[1]!.summary).toBe("broken: #2, #4");
    expect(rows[2]!.summary).toBe("broken: #2, #4 (first at #2)");
  });

  it("copes with a missing contract verdict", () => {
    const { records } = make(2);
    expect(verdictRows(verify(null), verifyRecords(records))[0]!.summary).toBe("not available");
  });
});

describe("explainDifferences", () => {
  it("says nothing when everyone agrees", () => {
    const { records, witnesses } = make(4);
    expect(explainDifferences(verify(contractOk), verifyRecords(records, { witnesses }))).toEqual([]);
    expect(explainDifferences(verify(null), verifyRecords(records, { witnesses }))).toEqual([]);
  });

  it("explains how the contract can be fooled by a complete rewrite", () => {
    const { records, witnesses } = make(5);
    const forged = records.map((r) => ({ ...r }));
    forged[2]!.price = 99n;
    for (let i = 2; i < forged.length; i++) {
      if (i > 2) forged[i]!.prevHash = forged[i - 1]!.hash;
      forged[i]!.hash = computeHash(forged[i]!);
    }
    const lines = explainDifferences(verify(contractOk), verifyRecords(forged, { witnesses }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("The contract says the ledger is valid");
    expect(lines[0]).toContain("starting at record #2");
    expect(lines[0]).toContain("cannot be rewritten");
  });

  it("explains that verifyLedger stops at the first problem when there are several", () => {
    const { records, witnesses } = make(6);
    records[1] = { ...records[1]!, price: 99n };
    records[4] = { ...records[4]!, price: 99n };
    const lines = explainDifferences(verify({ valid: false, brokenAt: "1", audit: { brokenIndexes: ["1", "4"], reasons: [1, 1] } }), verifyRecords(records, { witnesses }));
    expect(lines).toEqual(["verifyLedger() stops at the first problem (record #1). auditRange() lists all 2 broken records."]);
  });

  it("explains records only the event log can expose (level 2)", () => {
    const { records, witnesses } = make(5);
    const forged = records.map((r) => ({ ...r }));
    forged[2]!.price = 99n;
    forged[2]!.hash = computeHash(forged[2]!);       // the forged record looks consistent
    const result = verifyRecords(forged, { witnesses });
    const lines = explainDifferences(verify({ valid: false, brokenAt: "3", audit: { brokenIndexes: ["3"], reasons: [2] } }), result);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("also flags #2");
    expect(lines[0]).toContain("differ from the event log");
  });
});
