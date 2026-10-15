import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeHash } from "@dpp/shared";
import { EFFECT_MS } from "@/lib/statusEffects";
import { apiToLedgerRecord, verifyInBrowser } from "@/lib/verifyInBrowser";
import { validChain } from "@/test/fakes";
import { ChainStrip } from "./ChainStrip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Records = ReturnType<typeof validChain>;
const strip = (records: Records, props: object = {}) => <ChainStrip records={records} verification={verifyInBrowser(records)} animate={false} {...props} />;
const card = (i: number) => screen.getByRole("button", { name: new RegExp(`^Record ${i}:`) });
const edit = (r: Records, i: number, patch: Partial<Records[number]>): Records => r.map((x, k) => (k === i ? { ...x, ...patch } : x));

describe("effects when a verdict changes", () => {
  it("cracks a block whose data was edited, then settles", () => {
    const base = validChain(6);
    const { rerender } = render(strip(base));
    expect(card(3)).not.toHaveAttribute("data-effect");

    rerender(strip(edit(base, 3, { price: "9" })));
    expect(card(3)).toHaveAttribute("data-effect", "crack");
    expect(screen.getByTestId("crack")).toBeInTheDocument();
    expect(card(2)).not.toHaveAttribute("data-effect");

    act(() => { vi.advanceTimersByTime(EFFECT_MS + 100); });
    expect(card(3)).not.toHaveAttribute("data-effect");
    expect(screen.queryByTestId("crack")).not.toBeInTheDocument();
  });

  it("snaps the link after a forged record, and flags the block it leads into", () => {
    const base = validChain(6);
    const { rerender, container } = render(strip(base));
    const forged = edit(base, 3, { price: "9" });
    forged[3] = { ...forged[3]!, hash: computeHash({ ...apiToLedgerRecord(forged[3]!) }) };
    rerender(strip(forged));

    expect(card(4)).toHaveAttribute("data-effect", "flag");
    expect(card(3)).toHaveAttribute("data-effect", "seal");
    const snapped = container.querySelectorAll('[data-link-effect="snap"]');
    expect(snapped).toHaveLength(1);
    expect(snapped[0]).toHaveAttribute("data-link-ok", "false");
  });

  it("stamps seals with a growing delay along a rewritten tail", () => {
    const base = validChain(6);
    const ledger = base.map(apiToLedgerRecord);
    ledger[2]!.price += 5n;
    for (let i = 2; i < ledger.length; i++) {
      if (i > 2) ledger[i]!.prevHash = ledger[i - 1]!.hash;
      ledger[i]!.hash = computeHash(ledger[i]!);
    }
    const rewritten = base.map((r, i) => (i < 2 ? r : { ...r, price: ledger[i]!.price.toString(), prevHash: ledger[i]!.prevHash, hash: ledger[i]!.hash }));
    const { rerender } = render(strip(base));
    rerender(strip(rewritten));

    const delays = [2, 3, 4, 5].map((i) => card(i).style.getPropertyValue("--fx-delay"));
    expect(delays).toEqual(["0ms", "140ms", "280ms", "420ms"]);
    expect(screen.getAllByTestId("seal")).toHaveLength(4);
  });

  it("re-snaps the repaired blocks, left to right, when the attack is undone", () => {
    const base = validChain(6);
    const broken = edit(base, 3, { price: "9" });
    const { rerender } = render(strip(broken));
    rerender(strip(base));
    expect(card(3)).toHaveAttribute("data-effect", "resnap");
    expect(card(3).style.getPropertyValue("--fx-delay")).toBe("180ms");
  });

  it("plays nothing for the verdicts already showing when the view opens", () => {
    render(strip(edit(validChain(6), 3, { price: "9" })));
    expect(card(3)).not.toHaveAttribute("data-effect");
  });

  it("plays nothing when effects are switched off", () => {
    const base = validChain(6);
    const { rerender } = render(strip(base, { effects: false }));
    rerender(strip(edit(base, 3, { price: "9" }), { effects: false }));
    expect(card(3)).not.toHaveAttribute("data-effect");
  });
});

describe("reduced motion", () => {
  // vitest runs with the frontend package as the working directory
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  it("collapses every animation duration, so the final highlight is what remains", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.001ms !important/);
  });

  it("ends every effect on a visible highlight that the animation keeps", () => {
    for (const name of ["fx-crack", "fx-seal", "fx-flag", "fx-resnap"]) {
      const keyframes = css.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? css.match(new RegExp(`@keyframes ${name} \\{[^\\n]*\\}`))?.[0];
      expect(keyframes, name).toBeDefined();
      expect(keyframes, name).toMatch(/box-shadow: 0 0 0 3px var\(--status-/);
    }
    for (const kind of ["crack", "seal", "flag", "resnap"]) {
      expect(css).toMatch(new RegExp(`\\[data-effect="${kind}"\\][^}]*both`));
    }
  });
});
