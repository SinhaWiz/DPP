import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRecords, computeHash, type LedgerRecord } from "@dpp/shared";
import { verifyInBrowser } from "./verifyInBrowser";
import { validChain } from "@/test/fakes";
import { EFFECT_MS, diffEffects, useStatusEffects } from "./statusEffects";

const prevOf = (records = validChain(6)) => verifyInBrowser(records).checks.map((c) => ({ status: c.status, linkOk: c.linkOk }));
const checks = (records: ReturnType<typeof validChain>) => verifyInBrowser(records).checks;
const apiLike = (r: ReturnType<typeof validChain>[number]): LedgerRecord => ({
  index: BigInt(r.index), timestamp: BigInt(r.timestamp), productId: BigInt(r.productId), action: r.action as 0, actor: r.actor,
  counterparty: r.counterparty, price: BigInt(r.price), prevHash: r.prevHash, hash: r.hash,
});

describe("diffEffects", () => {
  it("does nothing when nothing changed", () => {
    const base = validChain(6);
    const e = diffEffects(prevOf(base), checks(base));
    expect(e.cards.size + e.links.size).toBe(0);
  });

  it("cracks the block whose data was edited (level 1)", () => {
    const base = validChain(6);
    const edited = base.map((r, i) => (i === 3 ? { ...r, price: "9" } : r));
    const e = diffEffects(prevOf(base), checks(edited));
    expect([...e.cards]).toEqual([[3, { kind: "crack", delayMs: 0 }]]);
    expect(e.links.size).toBe(0);
  });

  it("snaps the link after a forged record and flags the block it leads into (level 2)", () => {
    const base = validChain(6);
    // record #3 is edited and given a matching hash, so #4 still points at the old one
    const forged = base.map((r) => ({ ...r }));
    forged[3] = { ...forged[3]!, price: "9" };
    forged[3]!.hash = computeHash({ ...apiLike(forged[3]!) });
    const e = diffEffects(prevOf(base), checks(forged));
    expect(e.links.get(4)).toEqual({ kind: "snap", delayMs: 0 });
    expect(e.cards.get(4)).toEqual({ kind: "flag", delayMs: 0 });
    expect(e.cards.get(3)?.kind).toBe("seal");   // the forged block itself is exposed by the event log
  });

  it("stamps a seal along a rewritten tail, one block after another (level 3)", () => {
    const base = validChain(6);
    const ledger = base.map((r) => ({ ...r }));
    // rewrite from #2: consistent hashes, but the event-log witnesses still hold the originals
    const forged: LedgerRecord[] = ledger.map((r) => ({ index: BigInt(r.index), timestamp: BigInt(r.timestamp), productId: 1n, action: r.action as 0, actor: r.actor, counterparty: r.counterparty, price: BigInt(r.price), prevHash: r.prevHash, hash: r.hash }));
    forged[2]!.price += 5n;
    for (let i = 2; i < forged.length; i++) {
      if (i > 2) forged[i]!.prevHash = forged[i - 1]!.hash;
      forged[i]!.hash = computeHash(forged[i]!);
    }
    const witnesses = base.map((r) => ({ index: BigInt(r.index), productId: 1n, action: r.action as 0, actor: r.actor, prevHash: r.prevHash, hash: r.hash }));
    const e = diffEffects(prevOf(base), verifyRecords(forged, { witnesses }).checks);
    expect([...e.cards.keys()]).toEqual([2, 3, 4, 5]);
    expect(e.cards.get(2)).toEqual({ kind: "seal", delayMs: 0 });
    expect(e.cards.get(5)).toEqual({ kind: "seal", delayMs: 3 * 140 }); // the wave travels
    expect(e.links.size).toBe(0);
  });

  it("re-snaps the repaired block and link, left to right (restore)", () => {
    const base = validChain(6);
    const broken = base.map((r, i) => (i === 3 ? { ...r, price: "9" } : i === 4 ? { ...r, prevHash: "0x" + "ee".repeat(32) } : r));
    const e = diffEffects(prevOf(broken), checks(base));
    expect(e.cards.get(3)).toEqual({ kind: "resnap", delayMs: 180 });
    expect(e.cards.get(4)).toEqual({ kind: "resnap", delayMs: 240 });
    expect(e.links.get(4)).toEqual({ kind: "resnap", delayMs: 240 });
  });

  it("ignores records that were not there before", () => {
    const base = validChain(6);
    const e = diffEffects(prevOf(base).slice(0, 3), checks(base));
    expect(e.cards.size).toBe(0);
  });
});

describe("useStatusEffects", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const render = (records: ReturnType<typeof validChain>, enabled = true) =>
    renderHook(({ c, on }) => useStatusEffects(c, on), { initialProps: { c: checks(records), on: enabled } });

  it("treats the first verification as the baseline: no effects", () => {
    const base = validChain(6);
    const edited = base.map((r, i) => (i === 3 ? { ...r, price: "9" } : r));
    const { result } = render(edited);
    expect(result.current.cards.size).toBe(0);
  });

  it("plays an effect when a verdict changes, then clears it", () => {
    const base = validChain(6);
    const { result, rerender } = render(base);
    const edited = base.map((r, i) => (i === 3 ? { ...r, price: "9" } : r));
    rerender({ c: checks(edited), on: true });
    expect(result.current.cards.get(3)?.kind).toBe("crack");
    act(() => { vi.advanceTimersByTime(EFFECT_MS + 50); });
    expect(result.current.cards.size).toBe(0);
  });

  it("plays nothing when disabled", () => {
    const base = validChain(6);
    const { result, rerender } = render(base, false);
    rerender({ c: checks(base.map((r, i) => (i === 3 ? { ...r, price: "9" } : r))), on: false });
    expect(result.current.cards.size).toBe(0);
  });

  it("clears effects when the chain gets shorter (a rewind)", () => {
    const base = validChain(6);
    const { result, rerender } = render(base);
    rerender({ c: checks(base.map((r, i) => (i === 3 ? { ...r, price: "9" } : r))), on: true });
    expect(result.current.cards.size).toBe(1);
    rerender({ c: checks(base.slice(0, 3)), on: true });
    expect(result.current.cards.size).toBe(0);
  });
});
