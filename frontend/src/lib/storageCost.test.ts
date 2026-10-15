import { describe, expect, it } from "vitest";
import type { ApiTx } from "@dpp/shared";
import { storageRecordFixture } from "@/test/fakes";
import { EVENT_GAS, compareReadPaths, logGas, summarizeCost } from "./storageCost";

type Write = ReturnType<typeof storageRecordFixture>["storageWrites"][number];
const withWrites = (writes: Write[], gasUsed: string | null = "300000") => {
  const base = storageRecordFixture("1");
  return { ...base, storageWrites: writes, writtenBy: gasUsed ? ({ hash: "0xh", gasUsed } as unknown as ApiTx) : null };
};
const slotOf = (position: number) => storageRecordFixture("1").slots[position]!.slot;
const w = (position: number, kind: Write["kind"], gasCost: number | null, seq = position): Write => ({ seq, slot: slotOf(position), before: "0x0", after: "0x1", gasCost, kind });

describe("event gas", () => {
  it("follows the LOG formula: 375 + 375 per topic + 8 per data byte", () => {
    expect(logGas(0, 0)).toBe(375);
    expect(logGas(1, 32)).toBe(375 + 375 + 256);
    expect(EVENT_GAS).toBe(375 + 4 * 375 + 8 * 96); // 2,643
    expect(EVENT_GAS).toBe(2643);
  });
});

describe("summarizeCost", () => {
  it("is null when no writes were recorded", () => {
    expect(summarizeCost(withWrites([]))).toBeNull();
  });

  it("maps each write to its slot and explains the expensive ones", () => {
    const s = summarizeCost(withWrites([w(0, "new", 22100), w(1, "new", 22100)]))!;
    expect(s.writes.map((x) => x.position)).toEqual([0, 1]);
    expect(s.writes[0]).toMatchObject({ kind: "new", gas: 22100 });
    expect(s.writes[0]!.why).toContain("20,000");
    expect(s.writes[0]!.why).toContain("2,100");
  });

  it("recognises the cheap second write to the packed slot", () => {
    const s = summarizeCost(withWrites([w(3, "new", 20000, 0), w(3, "update", 100, 1)]))!;
    expect(s.writes.map((x) => x.kind)).toEqual(["new", "warm"]);
    expect(s.writes[1]!.why).toContain("already written earlier in the same transaction");
  });

  it("tells updates and cleared slots apart", () => {
    const s = summarizeCost(withWrites([w(5, "update", 2900), w(6, "cleared", 2900), w(7, "unchanged", 100)]))!;
    expect(s.writes.map((x) => x.kind)).toEqual(["update", "cleared", "warm"].map((k, i) => (i === 2 ? "unchanged" : k)));
    expect(s.writes[0]!.why).toContain("far cheaper");
    expect(s.writes[1]!.why).toContain("refund");
  });

  it("totals the record's gas and what share of the transaction it was", () => {
    const writes = Array.from({ length: 8 }, (_, p) => w(p, "new", 22100));
    const s = summarizeCost(withWrites(writes, "250000"))!;
    expect(s.recordGas).toBe(8 * 22100);
    expect(s.txGas).toBe(250000);
    expect(s.share).toBeCloseTo(176800 / 250000);
  });

  it("compares with the cost of an event", () => {
    const s = summarizeCost(withWrites([w(0, "new", 22100), w(1, "new", 22100)]))!;
    expect(s.eventGas).toBe(2643);
    expect(s.ratio).toBeCloseTo(44200 / 2643);
  });

  it("copes with unknown gas and an unknown transaction", () => {
    const s = summarizeCost(withWrites([w(0, "new", null)], null))!;
    expect(s.recordGas).toBe(0);
    expect(s.txGas).toBeNull();
    expect(s.share).toBeNull();
    expect(s.ratio).toBeNull();
  });
});

describe("compareReadPaths", () => {
  const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");

  it("lists the three ways, and says which ones read contract storage", () => {
    const c = compareReadPaths(storageRecordFixture("1"));
    expect(c.paths.map((p) => p.id)).toEqual(["call", "storage", "log"]);
    expect(c.paths.map((p) => p.readsStorage)).toEqual([true, true, false]);
  });

  it("agrees when storage, the contract and the log all say the same", () => {
    const c = compareReadPaths(storageRecordFixture("1"));
    expect(c.agree).toBe(true);
    expect(c.outliers).toEqual([]);
    expect(c.paths.every((p) => p.hash === hash(8) && p.prevHash === hash(7))).toBe(true);
  });

  it("singles out the log when storage was rewritten (level 3)", () => {
    const base = storageRecordFixture("1");
    const slots = base.slots.map((s) => (s.position === 7 ? { ...s, actual: hash(0xbad) } : s));
    const c = compareReadPaths({ ...base, slots, abiRecord: { ...base.abiRecord!, hash: hash(0xbad) } });
    expect(c.agree).toBe(false);
    expect(c.outliers).toEqual(["log"]);
  });

  it("singles out the raw storage when only it differs", () => {
    const base = storageRecordFixture("1");
    const slots = base.slots.map((s) => (s.position === 7 ? { ...s, actual: hash(0xbad) } : s));
    expect(compareReadPaths({ ...base, slots }).outliers).toEqual(["storage"]);
  });

  it("notices a differing prevHash even when the hashes agree", () => {
    const base = storageRecordFixture("1");
    expect(compareReadPaths({ ...base, witness: { ...base.witness!, prevHash: hash(0xdead) } }).agree).toBe(false);
  });

  it("ignores a path that has no value (e.g. no event was indexed)", () => {
    const c = compareReadPaths({ ...storageRecordFixture("1"), witness: null });
    expect(c.agree).toBe(true);
    expect(c.paths[2]!.hash).toBeNull();
  });
});
