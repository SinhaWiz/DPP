import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeHash } from "../src/hashRecipe";
import { compareWithContract, verifyIncremental, verifyRecords } from "../src/verifyEngine";
import { toLedgerRecord, type EventWitness, type LedgerRecord } from "../src/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/records.json", import.meta.url), "utf8")) as {
  records: Parameters<typeof toLedgerRecord>[0][];
};
const original: LedgerRecord[] = fixture.records.map(toLedgerRecord);
const witnesses: EventWitness[] = original.map((r) => ({
  index: r.index, productId: r.productId, action: r.action, actor: r.actor, prevHash: r.prevHash, hash: r.hash,
}));

const clone = () => original.map((r) => ({ ...r }));
const I = 5; // tamper target

/** Level 1: edit data only. */
function editData(records: LedgerRecord[]) {
  records[I]!.price += 999n;
}
/** Level 2: edit data and fix that record's own hash. */
function editDataAndHash(records: LedgerRecord[]) {
  editData(records);
  records[I]!.hash = computeHash(records[I]!);
}
/** Level 3: rewrite every record from I to the head so the whole tail is self-consistent. */
function rewriteTail(records: LedgerRecord[]) {
  editData(records);
  for (let i = I; i < records.length; i++) {
    if (i > I) records[i]!.prevHash = records[i - 1]!.hash;
    records[i]!.hash = computeHash(records[i]!);
  }
}

describe("verifyRecords", () => {
  it("accepts the untouched chain, with and without witnesses", () => {
    for (const w of [witnesses, undefined]) {
      const r = verifyRecords(original, { witnesses: w });
      expect(r.valid).toBe(true);
      expect(r.firstBrokenAt).toBeNull();
      expect(r.checks.every((c) => c.status === "intact")).toBe(true);
    }
  });

  it("level 1 (edit data): only that record is flagged, as dataTampered", () => {
    const recs = clone(); editData(recs);
    const r = verifyRecords(recs, { witnesses });
    expect(r.brokenIndexes).toEqual([BigInt(I)]);
    const c = r.checks[I]!;
    expect(c.status).toBe("dataTampered");
    expect(c.dataOk).toBe(false);
    expect(c.linkOk).toBe(true);
    expect(c.reasonMask).toBe(1);
    expect(r.checks[I + 1]!.status).toBe("intact"); // the next link still matches the stored hash
  });

  it("level 2 (edit data and fix hash): the contract sees the NEXT link break; the log also exposes the forged record", () => {
    const recs = clone(); editDataAndHash(recs);
    const r = verifyRecords(recs, { witnesses });

    // what the contract can see
    expect(r.checks[I]!.onChainStatus).toBe("intact");
    expect(r.checks[I + 1]!.onChainStatus).toBe("linkBroken");
    expect(r.firstBrokenOnChainAt).toBe(BigInt(I + 1));
    expect(r.checks[I + 1]!.reasonMask).toBe(2);

    // with the event log, the forged record itself is exposed too
    expect(r.checks[I]!.status).toBe("anchorMismatch");
    expect(r.firstBrokenAt).toBe(BigInt(I));
    expect(r.brokenIndexes).toEqual([BigInt(I), BigInt(I + 1)]);
  });

  it("level 3 (rewrite the tail): invisible to the contract, caught by the event log", () => {
    const recs = clone(); rewriteTail(recs);

    const withoutLog = verifyRecords(recs);
    expect(withoutLog.valid).toBe(true);                 // self-consistent: nothing to see
    expect(withoutLog.firstBrokenOnChainAt).toBeNull();

    const withLog = verifyRecords(recs, { witnesses });
    expect(withLog.valid).toBe(false);
    expect(withLog.firstBrokenOnChainAt).toBeNull();     // the contract still says "valid"
    expect(withLog.firstBrokenAt).toBe(BigInt(I));
    expect(withLog.brokenIndexes).toHaveLength(original.length - I);
    expect(withLog.checks.slice(I).every((c) => c.status === "anchorMismatch")).toBe(true);
    expect(withLog.checks.slice(0, I).every((c) => c.status === "intact")).toBe(true);
  });

  it("reports several separate problems", () => {
    const recs = clone();
    recs[2]!.price += 1n; recs[8]!.price += 1n;
    expect(verifyRecords(recs).brokenIndexes).toEqual([2n, 8n]);
  });

  it("flags both reasons when data and link are both wrong", () => {
    const recs = clone();
    recs[I]!.price += 1n;
    recs[I]!.prevHash = recs[0]!.hash;
    const c = verifyRecords(recs).checks[I]!;
    expect(c.reasonMask).toBe(3);
    expect(c.status).toBe("dataTampered");
    expect(c.reasons).toHaveLength(2);
  });

  it("leaves anchorOk null (not failed) when no witness exists for a record", () => {
    const r = verifyRecords(original, { witnesses: witnesses.slice(0, 3) });
    expect(r.checks[1]!.anchorOk).toBe(true);
    expect(r.checks[10]!.anchorOk).toBeNull();
    expect(r.valid).toBe(true);
  });

  it("verifies a page from the middle given the previous hash", () => {
    const page = original.slice(10, 15);
    expect(verifyRecords(page, { previousHash: original[9]!.hash }).valid).toBe(true);
    expect(verifyRecords(page, { previousHash: original[0]!.hash }).checks[0]!.status).toBe("linkBroken");
    // without a previous hash the first link is simply not checked
    expect(verifyRecords(page).valid).toBe(true);
  });

  it("compares hashes case-insensitively", () => {
    const recs = clone();
    recs[3]!.hash = recs[3]!.hash.toUpperCase().replace("0X", "0x");
    expect(verifyRecords(recs).checks[3]!.dataOk).toBe(true);
  });
});

describe("verifyIncremental", () => {
  it("matches a full run when new records are appended", () => {
    const head = original.slice(0, 12);
    const first = verifyRecords(head, { witnesses });
    const incremental = verifyIncremental(first, original, 12, { witnesses });
    expect(incremental).toEqual(verifyRecords(original, { witnesses }));
  });

  it("re-checks from the changed record onward", () => {
    const first = verifyRecords(original, { witnesses });
    const recs = clone(); rewriteTail(recs);
    const incremental = verifyIncremental(first, recs, I, { witnesses });
    expect(incremental).toEqual(verifyRecords(recs, { witnesses }));
  });
});

describe("compareWithContract", () => {
  it("agrees on a data tamper", () => {
    const recs = clone(); editData(recs);
    const r = verifyRecords(recs, { witnesses });
    const cmp = compareWithContract(r, {
      valid: false, brokenAt: BigInt(I), audit: { brokenIndexes: [BigInt(I)], reasons: [1] },
    });
    expect(cmp.agree).toBe(true);
    expect(cmp.contractFooled).toBe(false);
    expect(cmp.notes).toEqual([]);
  });

  it("says the contract was fooled by a full tail rewrite", () => {
    const recs = clone(); rewriteTail(recs);
    const r = verifyRecords(recs, { witnesses });
    const cmp = compareWithContract(r, { valid: true, brokenAt: 0n });
    expect(cmp.agree).toBe(true);
    expect(cmp.contractFooled).toBe(true);
    expect(cmp.notes[0]).toContain("self-consistent rewrite");
  });

  it("reports a disagreement", () => {
    const recs = clone(); editData(recs);
    const cmp = compareWithContract(verifyRecords(recs), { valid: false, brokenAt: 2n });
    expect(cmp.agree).toBe(false);
  });
});
