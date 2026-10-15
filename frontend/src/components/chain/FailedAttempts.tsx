import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiTx } from "@dpp/shared";
import { Address, Eth } from "@/components/common/Primitives";
import { Tooltip } from "@/components/common/Tooltip";
import { formatEth, shortHash } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";
import { getTxFlow } from "@/store/flowInstance";
import { useLive } from "@/store/live";
import { useUi } from "@/store/uiStore";

const NEVER_RECORDED = ["failed", "replaced", "dropped"] as const;
const ANIMATE_MS = 2200;

const WHY: Record<(typeof NEVER_RECORDED)[number], { icon: string; label: string; short: string }> = {
  failed: { icon: "✘", label: "Reverted", short: "Mined, but the contract rejected it" },
  replaced: { icon: "⇄", label: "Replaced", short: "Another transaction took its nonce" },
  dropped: { icon: "⌫", label: "Dropped", short: "Removed before it was mined" },
};

/** Transactions that were never recorded in the ledger: the contract rejected them, or they never ran. */
export function useUnrecorded(): ApiTx[] {
  const txs = useLive((s) => s.txs);
  return useMemo(() => txs.filter((t) => (NEVER_RECORDED as readonly string[]).includes(t.state)), [txs]);
}

/** Hashes that appeared after this view was first shown (so they get the animation). */
function useArrivals(items: ApiTx[], ready: boolean): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!ready) return; // what is there when the data first arrives is not "new"
    if (seen.current === null) {
      seen.current = new Set(items.map((t) => t.hash));
      return;
    }
    const added = items.filter((t) => !seen.current!.has(t.hash)).map((t) => t.hash);
    added.forEach((h) => seen.current!.add(h));
    if (added.length === 0) return;
    setFresh((f) => new Set([...f, ...added]));
    const timer = setTimeout(() => setFresh((f) => new Set([...f].filter((h) => !added.includes(h)))), ANIMATE_MS);
    return () => clearTimeout(timer);
  }, [items, ready]);
  return fresh;
}

/** Costs gas only when mined: a replaced or dropped transaction cost nothing. */
function gasCost(t: ApiTx): bigint | null {
  if (t.state !== "failed" || !t.gasUsed || !t.effectiveGasPrice) return null;
  return BigInt(t.gasUsed) * BigInt(t.effectiveGasPrice);
}

function AttemptTooltip({ t }: { t: ApiTx }) {
  const why = WHY[t.state as keyof typeof WHY];
  const cost = gasCost(t);
  return (
    <div className="w-72 text-sm">
      <p className="mb-1 rounded bg-surface-2 px-2 py-1 text-xs font-medium">Not in the ledger: this attempt never became a record.</p>
      <p className="font-medium">{why.icon} {why.label}: {t.revert?.title ?? why.short}</p>
      {t.revert ? (
        <>
          <p className="mt-1">{t.revert.explanation}</p>
          <p className="mt-1 text-muted">{t.revert.fix}</p>
        </>
      ) : (
        <p className="mt-1 text-muted">{t.state === "replaced" ? "It was never mined; a transaction with the same nonce ran instead." : "It left the mempool before any block included it."}</p>
      )}
      <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-muted">Sender</dt><dd><Address value={t.from} copy={false} /></dd>
        <dt className="text-muted">Nonce</dt><dd>{t.nonce}</dd>
        {t.blockNumber != null && (<><dt className="text-muted">Block</dt><dd>{t.blockNumber}</dd></>)}
        {cost !== null && (<><dt className="text-muted">Gas paid</dt><dd>{formatEth(cost, 8)} ETH <span className="text-muted">(spent anyway)</span></dd></>)}
        {t.state === "replaced" && t.replacedBy && (<><dt className="text-muted">Replaced by</dt><dd className="font-mono">{shortHash(t.replacedBy)}</dd></>)}
        <dt className="text-muted">Hash</dt><dd className="font-mono">{shortHash(t.hash)}</dd>
      </dl>
    </div>
  );
}

export function FailedAttempts() {
  const items = useUnrecorded();
  const loaded = useLive((s) => s.loaded);
  const arrivals = useArrivals(items, loaded);
  const reduce = usePrefersReducedMotion();

  const open = async (hash: string) => {
    await getTxFlow().replay(hash).catch(() => undefined);
    useUi.getState().setDockTab("pipeline");
  };

  return (
    <section aria-label="Failed attempts" className="mt-4 rounded-xl border border-dashed border-border p-3">
      <h2 className="text-sm font-semibold">Attempts that never reached the ledger</h2>
      <p className="mb-2 text-xs text-muted">
        A reverted transaction is mined and costs gas, but the revert undoes everything, including the ledger entry. Replaced and dropped ones never ran at all.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">None yet. Try something the contract will refuse, such as buying a product you already own.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((t) => {
            const why = WHY[t.state as keyof typeof WHY];
            const isNew = arrivals.has(t.hash);
            return (
              <li key={t.hash}>
                <Tooltip content={<AttemptTooltip t={t} />} delay={150} interactive>
                  <motion.button
                    type="button"
                    onClick={() => void open(t.hash)}
                    data-fresh={isNew || undefined}
                    data-state={t.state}
                    aria-label={`${why.label}: ${t.functionName ?? "transaction"}${t.revert?.name ? `, ${t.revert.name}` : ""}. Not in the ledger.`}
                    // the attempt reaches for the chain, bounces off, and drops into the tray
                    initial={isNew && !reduce ? { y: -36, x: 28, opacity: 0, rotate: 0 } : false}
                    animate={isNew && !reduce ? { y: [-36, -36, 0], x: [28, 44, 0], opacity: 1, rotate: [0, 7, -4, 3, 0] } : { y: 0, x: 0, opacity: 1 }}
                    transition={{ duration: 1.2, times: [0, 0.45, 1] }}
                    className={`flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 text-left text-sm ${
                      t.state === "failed" ? "border-tampered" : "border-neutral border-dashed"
                    } ${isNew && reduce ? "ring-2 ring-accent" : ""} bg-surface hover:bg-surface-2`}
                  >
                    <span aria-hidden className={t.state === "failed" ? "text-tampered" : "text-neutral"}>{why.icon}</span>
                    <span className={t.state === "failed" ? "" : "line-through opacity-70"}>
                      <span className="font-mono">{t.functionName ?? "transfer"}</span>
                      <span className="block text-xs text-muted">{t.revert?.name ?? why.label}{t.value !== "0" && <> · <Eth wei={t.value} /></>}</span>
                    </span>
                  </motion.button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
