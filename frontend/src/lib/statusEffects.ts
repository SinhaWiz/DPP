import { useEffect, useRef, useState } from "react";
import type { RecordCheck, VerificationStatus } from "@dpp/shared";

export type CardEffect = { kind: "crack" | "seal" | "resnap" | "flag"; delayMs: number };
export type LinkEffect = { kind: "snap" | "resnap"; delayMs: number };

export interface Effects {
  cards: Map<number, CardEffect>;
  links: Map<number, LinkEffect>;
}

/** How long an effect stays on screen. */
export const EFFECT_MS = 2600;
const WAVE_STEP_MS = 140;

interface Prev {
  status: VerificationStatus;
  linkOk: boolean;
}

/**
 * What changed between two verifications, as things to animate. `links` is keyed by the index of the
 * record on the link's right-hand side (the link between #i-1 and #i has key i).
 *
 *  intact → data tampered   crack the block
 *  anything → log mismatch  a seal stamped along the rewritten tail, one block after another
 *  link ok → broken         the link snaps; the block it leads into is flagged
 *  broken → intact          the block (and link) re-snap, left to right
 */
export function diffEffects(prev: Prev[], next: RecordCheck[]): Effects {
  const cards = new Map<number, CardEffect>();
  const links = new Map<number, LinkEffect>();

  const changedSeals = next.map((c, i) => (c.status === "anchorMismatch" && prev[i]?.status !== "anchorMismatch" ? i : -1)).filter((i) => i >= 0);
  const firstSeal = changedSeals[0] ?? 0;

  next.forEach((c, i) => {
    const before = prev[i];
    if (!before) return; // a brand-new record is not "broken" or "fixed"

    if (c.status !== before.status) {
      if (c.status === "dataTampered") cards.set(i, { kind: "crack", delayMs: 0 });
      else if (c.status === "anchorMismatch") cards.set(i, { kind: "seal", delayMs: (i - firstSeal) * WAVE_STEP_MS });
      else if (c.status === "linkBroken") cards.set(i, { kind: "flag", delayMs: 0 });
      else if (c.status === "intact") cards.set(i, { kind: "resnap", delayMs: i * 60 });
    }
    if (c.linkOk !== before.linkOk) {
      links.set(i, c.linkOk ? { kind: "resnap", delayMs: i * 60 } : { kind: "snap", delayMs: 0 });
    }
  });
  return { cards, links };
}

const NONE: Effects = { cards: new Map(), links: new Map() };

/** Tracks verification changes and exposes the effects to play, for a short while after each change. */
export function useStatusEffects(checks: RecordCheck[], enabled = true): Effects {
  const prev = useRef<Prev[] | null>(null);
  const [effects, setEffects] = useState<Effects>(NONE);

  useEffect(() => {
    const now: Prev[] = checks.map((c) => ({ status: c.status, linkOk: c.linkOk }));
    const before = prev.current;
    prev.current = now;
    if (!enabled || before === null) return;           // the first look is the baseline
    if (now.length < before.length) { setEffects(NONE); return; } // the chain got shorter: nothing to animate

    const next = diffEffects(before, checks);
    if (next.cards.size === 0 && next.links.size === 0) return;
    setEffects(next);
    const timer = setTimeout(() => setEffects(NONE), EFFECT_MS + Math.max(0, ...[...next.cards.values()].map((e) => e.delayMs)));
    return () => clearTimeout(timer);
  }, [checks, enabled]);

  return effects;
}
