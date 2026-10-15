import { motion } from "framer-motion";
import type { LinkEffect } from "@/lib/statusEffects";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";
import { LINK_W } from "./BlockCard";

export interface ChainLinkProps {
  /** `prevHash` of the right-hand record equals the stored hash of the left-hand one. */
  ok: boolean;
  /** Index of the record on the left. */
  from: bigint | null;
  highlighted?: boolean;
  /** The link was just formed: draw it in. */
  fresh?: boolean;
  /** The link just broke or was repaired. */
  effect?: LinkEffect;
}

/** The connector between two blocks. Green and solid when the hashes match; red and dashed when they don't. */
export function ChainLink({ ok, from, highlighted = false, fresh = false, effect }: ChainLinkProps) {
  const reduce = usePrefersReducedMotion();
  const Line = fresh && !reduce ? motion.line : "line";
  const drawProps = fresh && !reduce ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.6, delay: 0.5 } } : {};
  const color = ok ? "var(--status-intact)" : "var(--status-data)";
  const label = from === null ? "genesis link" : `prevHash equals hash of #${from}`;
  return (
    <span
      role="img"
      aria-label={ok ? `Link intact: ${label}` : `Link broken: ${label} is false`}
      data-link-ok={ok}
      data-link-effect={effect?.kind}
      className="relative flex h-36 shrink-0 items-center justify-center"
      style={{ width: LINK_W, ...(effect ? ({ "--fx-delay": `${effect.delayMs}ms` } as React.CSSProperties) : {}) }}
    >
      <svg width={LINK_W} height="24" viewBox={`0 0 ${LINK_W} 24`} aria-hidden>
        <Line
          x1="2" y1="12" x2={LINK_W - 8} y2="12" stroke={color} strokeWidth={highlighted ? 4 : 2.5}
          strokeDasharray={ok ? undefined : "5 4"} strokeLinecap="round" data-fresh={fresh || undefined}
          {...(drawProps as object)}
        />
        {ok ? (
          <path d={`M${LINK_W - 12} 7 L${LINK_W - 3} 12 L${LINK_W - 12} 17`} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <g stroke={color} strokeWidth="2.5" strokeLinecap="round">
            <line x1={LINK_W / 2 - 5} y1="7" x2={LINK_W / 2 + 5} y2="17" />
            <line x1={LINK_W / 2 + 5} y1="7" x2={LINK_W / 2 - 5} y2="17" />
          </g>
        )}
      </svg>
      <span className="absolute bottom-6 text-[10px] text-muted" aria-hidden>{ok ? "linked" : "broken"}</span>
    </span>
  );
}

/** What stands to the left of record #0: nothing, and the all-zero hash says so. */
export function GenesisMarker() {
  return (
    <span className="flex h-36 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-3 text-center text-xs text-muted" style={{ width: 120 }}>
      <span aria-hidden className="text-lg">⌀</span>
      <span className="font-medium text-text">Genesis</span>
      <span className="font-mono">0x000000…0000</span>
      <span>start of the chain</span>
    </span>
  );
}
