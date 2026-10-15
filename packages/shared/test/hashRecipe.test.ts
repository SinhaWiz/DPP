import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeHash, explainHash } from "../src/hashRecipe";
import { GENESIS_HASH, toLedgerRecord, type LedgerRecord } from "../src/types";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/records.json", import.meta.url), "utf8"),
) as { records: Parameters<typeof toLedgerRecord>[0][] };
const records: LedgerRecord[] = fixture.records.map(toLedgerRecord);

describe("hash recipe parity with the contract", () => {
  it("has a fixture covering every action", () => {
    expect(records.length).toBeGreaterThan(20);
    expect(new Set(records.map((r) => r.action))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("recomputes the on-chain hash of every real record", () => {
    for (const r of records) expect(computeHash(r), `record #${r.index}`).toBe(r.hash);
  });

  it("explainHash agrees with computeHash and encodes 8 words", () => {
    for (const r of records) {
      const e = explainHash(r);
      expect(e.hash).toBe(r.hash);
      expect(e.fields).toHaveLength(8);
      expect((e.encoded.length - 2) / 2).toBe(256);
      e.fields.forEach((f) => expect((f.word.length - 2) / 2).toBe(32));
    }
  });

  it("changing any single field changes the hash", () => {
    const r = records[3]!;
    const variants: Partial<LedgerRecord>[] = [
      { index: r.index + 1n }, { timestamp: r.timestamp + 1n }, { productId: r.productId + 1n },
      { action: ((r.action + 1) % 6) as LedgerRecord["action"] }, { actor: records[0]!.counterparty },
      { counterparty: r.actor }, { price: r.price + 1n }, { prevHash: GENESIS_HASH },
    ];
    for (const v of variants) expect(computeHash({ ...r, ...v })).not.toBe(r.hash);
  });

  it("links the first record to the genesis hash", () => {
    expect(records[0]!.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < records.length; i++) expect(records[i]!.prevHash).toBe(records[i - 1]!.hash);
  });
});
