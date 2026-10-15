import { useState } from "react";
import { ChainStrip } from "@/components/chain/ChainStrip";
import { EmptyState } from "@/components/layout/Panels";
import { ActivityFeed } from "@/components/pipeline/ActivityFeed";
import { MempoolTray } from "@/components/pipeline/MempoolTray";
import { TxPipeline } from "@/components/pipeline/TxPipeline";
import { useBrowserVerification } from "@/lib/useVerification";
import { useLive } from "@/store/live";

/**
 * A single workspace for trying things: act on the left, and here watch the chain, the transaction's
 * journey, the mempool and the history, all at once.
 */
export function Playground() {
  const records = useLive((s) => s.records);
  const loaded = useLive((s) => s.loaded);
  const mode = useLive((s) => s.mining?.mode ?? null);
  const { result } = useBrowserVerification();
  const [tab, setTab] = useState<"pipeline" | "mempool" | "activity">("pipeline");

  const tabs = [
    { id: "pipeline", label: "Transaction pipeline", body: <TxPipeline /> },
    { id: "mempool", label: "Mempool", body: <MempoolTray /> },
    { id: "activity", label: "Activity", body: <ActivityFeed /> },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Playground</h1>
        <p className="text-muted">Act as any role and watch each transaction travel step by step.</p>
      </div>

      <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="How to use the playground">
        <li className="rounded-lg border border-border p-3"><strong>1. Pick who you are.</strong> Use <em>Act as</em> in the top bar to choose a role.</li>
        <li className="rounded-lg border border-border p-3"><strong>2. Choose an action.</strong> The panel on the left predicts what will happen before you send it.</li>
        <li className="rounded-lg border border-border p-3">
          <strong>3. Watch it travel.</strong> {mode === "manual" ? "You are in Step mode: press Mine block to include it." : "Try Step mode in the top bar to see it wait in the mempool."}
        </li>
      </ol>

      <section aria-label="The chain">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">The chain</h2>
        {!loaded ? <EmptyState title="Loading the chain…" /> : <ChainStrip records={records} verification={result} compact />}
      </section>

      <section aria-label="Your transaction">
        <div role="tablist" aria-label="Transaction views" className="mb-2 flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`pg-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`pg-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`rounded-t-md px-3 py-1.5 text-sm ${tab === t.id ? "border-b-2 border-accent font-medium" : "text-muted hover:text-text"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tabs.map((t) => (
          <div key={t.id} role="tabpanel" id={`pg-panel-${t.id}`} aria-labelledby={`pg-tab-${t.id}`} hidden={tab !== t.id} className="min-h-24">
            {tab === t.id && t.body}
          </div>
        ))}
      </section>
    </div>
  );
}
