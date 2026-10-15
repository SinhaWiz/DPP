import { useMemo, useState } from "react";
import { EmptyState } from "@/components/layout/Panels";
import { Address, Eth, LifecyclePill } from "@/components/common/Primitives";
import { formatTime, shortHash } from "@/lib/format";
import { useRoles } from "@/lib/roles";
import { getTxFlow } from "@/store/flowInstance";
import { useLive } from "@/store/live";
import { useUi } from "@/store/uiStore";
import type { LifecycleState } from "@/store/flowTypes";

const STATES: { value: "" | LifecycleState; label: string }[] = [
  { value: "", label: "All states" },
  { value: "mined", label: "Succeeded" },
  { value: "failed", label: "Failed (reverted)" },
  { value: "pending", label: "Pending" },
  { value: "replaced", label: "Replaced" },
  { value: "dropped", label: "Dropped" },
];

/** Every transaction the node has seen, with filters. Click one to replay its pipeline. */
export function ActivityFeed() {
  const { txs, total, products } = useLive((s) => ({ txs: s.txs, total: s.txsTotal, products: s.products }));
  const roles = useRoles().filter((r) => r.index >= 0);
  const [state, setState] = useState<"" | LifecycleState>("");
  const [account, setAccount] = useState("");
  const [product, setProduct] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      txs.filter(
        (t) =>
          (state === "" || t.state === state) &&
          (account === "" || t.from.toLowerCase() === account.toLowerCase()) &&
          (product === "" || t.args?.productId === product),
      ),
    [txs, state, account, product],
  );

  const open = async (hash: string) => {
    setError(null);
    try {
      await getTxFlow().replay(hash);
      useUi.getState().setDockTab("pipeline");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (txs.length === 0) return <EmptyState title="No transactions yet" hint="Transactions you send, and how far each one got, show up here." />;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col"><span className="text-xs text-muted">State</span>
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} className="rounded-md border border-border bg-surface px-2 py-1">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col"><span className="text-xs text-muted">Account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="">Everyone</option>
            {roles.map((r) => <option key={r.address} value={r.address}>{r.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col"><span className="text-xs text-muted">Product</span>
          <select value={product} onChange={(e) => setProduct(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.name}</option>)}
          </select>
        </label>
        <span className="pb-1 text-muted">Showing {rows.length} of {total}</span>
        {error && <span role="alert" className="pb-1 text-tampered">{error}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No transaction matches these filters.</p>
      ) : (
        <ul aria-label="Transactions" className="divide-y divide-border rounded-lg border border-border">
          {rows.map((t) => (
            <li key={t.hash}>
              <button type="button" onClick={() => void open(t.hash)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left text-sm hover:bg-surface-2" aria-label={`Replay ${t.functionName ?? "transaction"} ${shortHash(t.hash)}`}>
                <span className="w-16 font-mono text-xs text-muted">{formatTime(t.firstSeenAt, "ms")}</span>
                <LifecyclePill state={t.state} />
                <span className="font-mono">{t.functionName ?? "transfer"}({t.args ? Object.values(t.args).join(", ") : ""})</span>
                <Address value={t.from} copy={false} />
                {t.value !== "0" && <Eth wei={t.value} />}
                {t.blockNumber != null && <span className="text-xs text-muted">block {t.blockNumber}</span>}
                {t.revert && <span className="text-xs text-tampered">{t.revert.name ?? "reverted"}</span>}
                {t.recordIndex !== null && <span className="text-xs text-muted">→ record #{t.recordIndex}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
