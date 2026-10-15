import { useMemo } from "react";
import { Address, Eth, LifecyclePill } from "@/components/common/Primitives";
import { EmptyState } from "@/components/layout/Panels";
import { shortHash } from "@/lib/format";
import { getLiveController, useLive } from "@/store/live";

/** Transactions that have been sent and are waiting for a block. */
export function MempoolTray() {
  // Select stable references and derive in the component: a selector that builds a new array each time never settles.
  const { txs, mining, lab } = useLive((s) => ({ txs: s.txs, mining: s.mining, lab: s.session?.lab.available ?? false }));
  const pending = useMemo(() => txs.filter((t) => t.state === "pending"), [txs]);

  if (pending.length === 0) {
    return (
      <EmptyState
        title="Nothing is waiting"
        hint={
          mining?.mode === "auto"
            ? "On automatic mining a transaction is mined the moment it is sent, so the mempool is always empty. Switch to Step mode to watch transactions wait."
            : "Send a transaction and it waits here until a block includes it."
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        {pending.length} transaction{pending.length === 1 ? "" : "s"} waiting for a block.
        {lab && mining?.mode === "manual" && (
          <button type="button" onClick={() => void getLiveController().api.lab.mine(1)} className="ml-2 rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-white">
            Mine them now
          </button>
        )}
      </p>
      <ul aria-label="Pending transactions" className="space-y-1.5">
        {pending.map((t) => (
          <li key={t.hash} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-pending/60 p-2 text-sm">
            <LifecyclePill state="pending" />
            <span className="font-mono">{t.functionName ?? "transfer"}({t.args ? Object.values(t.args).join(", ") : ""})</span>
            <Address value={t.from} copy={false} />
            <span className="text-muted">nonce {t.nonce}</span>
            {t.value !== "0" && <Eth wei={t.value} />}
            <span className="font-mono text-xs text-muted" title={t.hash}>{shortHash(t.hash)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
