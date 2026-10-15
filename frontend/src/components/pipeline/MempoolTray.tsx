import { useMemo, useState } from "react";
import type { ApiTx } from "@dpp/shared";
import { Address, Eth, LifecyclePill } from "@/components/common/Primitives";
import { EmptyState } from "@/components/layout/Panels";
import { shortHash } from "@/lib/format";
import { getLiveController, useLive } from "@/store/live";
import { useWallet } from "@/store/wallet";
import { cancelWithWallet } from "@/web3/replace";

type Action = "speedUp" | "cancel" | "drop";

/** Transactions that have been sent and are waiting for a block, and what can still be done about them. */
export function MempoolTray() {
  // Select stable references and derive in the component: a selector that builds a new array each time never settles.
  const { txs, mining, lab } = useLive((s) => ({ txs: s.txs, mining: s.mining, lab: s.session?.lab.available ?? false }));
  const pending = useMemo(() => txs.filter((t) => t.state === "pending"), [txs]);
  const wallet = useWallet((s) => s.wallet);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (t: ApiTx, action: Action) => {
    setBusy(t.hash);
    setError(null);
    try {
      const api = getLiveController().api;
      if (action === "drop") await api.lab.dropTx(t.hash);
      else if (action === "speedUp") await api.lab.replaceTx(t.hash, "speedUp");
      // Your own wallet can cancel its own transaction; anything else goes through the lab.
      else if (wallet?.kind === "metamask" && wallet.address.toLowerCase() === t.from.toLowerCase()) await cancelWithWallet(wallet.signer, t);
      else await api.lab.replaceTx(t.hash, "cancel");
      await getLiveController().flush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

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
      <p className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
        Until a block includes it, a transaction is only a request. You can still replace it with another that uses the same nonce and pays a higher fee,
        or the node can drop it. Once mined it is final: the only way to undo it is a new, opposite transaction.
      </p>
      {error && <p role="alert" className="text-sm text-tampered">{error}</p>}
      <ul aria-label="Pending transactions" className="space-y-1.5">
        {pending.map((t) => (
          <li key={t.hash} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-pending/60 p-2 text-sm">
            <LifecyclePill state="pending" />
            <span className="font-mono">{t.functionName ?? "transfer"}({t.args ? Object.values(t.args).join(", ") : ""})</span>
            <Address value={t.from} copy={false} />
            <span className="text-muted">nonce {t.nonce}</span>
            {t.value !== "0" && <Eth wei={t.value} />}
            <span className="font-mono text-xs text-muted" title={t.hash}>{shortHash(t.hash)}</span>
            <span className="ml-auto flex gap-1" role="group" aria-label={`Actions for ${t.functionName ?? "transaction"} with nonce ${t.nonce}`}>
              {([["speedUp", "Speed up", "Send the same call again with a higher fee"], ["cancel", "Cancel", "Replace it with a 0-ETH transfer to yourself, same nonce, higher fee"], ["drop", "Drop", "The node removes it from the mempool (local chain only)"]] as const).map(([a, label, hint]) => (
                <button
                  key={a}
                  type="button"
                  title={hint}
                  disabled={busy !== null || (!lab && !(a === "cancel" && wallet?.kind === "metamask" && wallet.address.toLowerCase() === t.from.toLowerCase()))}
                  onClick={() => void act(t, a)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-surface-2 disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
