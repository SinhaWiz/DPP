import type { ApiStorageRecord } from "@dpp/shared";
import { Hash } from "@/components/common/Primitives";
import { group } from "@/lib/format";
import { compareReadPaths, summarizeCost, type WriteKind } from "@/lib/storageCost";

const KIND: Record<WriteKind, { label: string; cls: string }> = {
  new: { label: "new slot", cls: "border-tampered text-tampered" },
  update: { label: "update", cls: "border-pending text-pending" },
  warm: { label: "rewrite", cls: "border-intact text-intact" },
  cleared: { label: "cleared", cls: "border-neutral text-neutral" },
  unchanged: { label: "same value", cls: "border-neutral text-neutral" },
};

/** What writing this record cost, write by write, and why. */
export function WriteCost({ data }: { data: ApiStorageRecord }) {
  const cost = summarizeCost(data);
  return (
    <section aria-label="What it cost to store" className="space-y-2">
      <h2 className="text-lg font-semibold">What it cost to store</h2>
      {!cost ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          No storage writes were recorded for this record. The cost breakdown needs the node to trace the transaction that created it, which a hosted node may not allow.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Every slot a transaction writes has a price. Creating a record writes eight slots, and a slot that goes from zero to non-zero is the most expensive thing the EVM does.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="pr-3 font-normal">#</th><th className="pr-3 font-normal">Slot</th><th className="pr-3 font-normal">Kind</th><th className="pr-3 text-right font-normal">Gas</th><th className="font-normal">Why</th></tr>
              </thead>
              <tbody>
                {cost.writes.map((w) => (
                  <tr key={w.seq} className="border-t border-border align-top">
                    <td className="py-1 pr-3 font-mono text-xs text-muted">{w.seq + 1}</td>
                    <td className="py-1 pr-3 font-mono text-xs">+{w.position}</td>
                    <td className="py-1 pr-3"><span className={`rounded-full border px-2 py-0.5 text-xs ${KIND[w.kind].cls}`}>{KIND[w.kind].label}</span></td>
                    <td className="py-1 pr-3 text-right font-mono">{w.gas === null ? "?" : group(w.gas)}</td>
                    <td className="py-1 text-xs text-muted">{w.why}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  <td colSpan={3} className="pt-1.5">Storing this record</td>
                  <td className="pt-1.5 text-right font-mono">{group(cost.recordGas)}</td>
                  <td className="pt-1.5 pl-3 text-xs font-normal text-muted">
                    {cost.share !== null && cost.txGas ? `${Math.round(cost.share * 100)}% of the ${group(cost.txGas)} gas the whole transaction used` : "gas, as traced"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <aside aria-label="Storage versus events" className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="font-medium">Storage or an event?</p>
            <p className="mt-1 text-muted">
              Announcing the same facts in an event costs about <strong className="text-text">{group(cost.eventGas)} gas</strong>
              {cost.ratio ? <>, roughly <strong className="text-text">{Math.round(cost.ratio)}× cheaper</strong> than these storage writes</> : null}.
              But a contract cannot read an event, only storage. This ledger keeps records in storage so that <code>verifyLedger()</code> can check them on chain.
              Apps like this one read the events instead, and use them as an independent witness.
            </p>
          </aside>
        </>
      )}
    </section>
  );
}

/** The same record read three ways, to show they agree (or which one does not). */
export function ReadBack({ data }: { data: ApiStorageRecord }) {
  const cmp = compareReadPaths(data);
  return (
    <section aria-label="Three ways to read it back" className="space-y-2">
      <h2 className="text-lg font-semibold">Three ways to read it back</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {cmp.paths.map((p) => {
          const odd = cmp.outliers.includes(p.id);
          return (
            <article key={p.id} aria-label={p.title} className={`rounded-lg border p-3 ${odd ? "border-tampered bg-tampered/5" : "border-border"}`}>
              <h3 className="font-medium">{p.title} {odd && <span className="text-tampered" aria-label="differs">✘</span>}</h3>
              <p className="mb-2 text-xs text-muted">{p.how}</p>
              <dl className="space-y-0.5 text-sm">
                <div className="flex gap-2"><dt className="w-16 text-muted">hash</dt><dd>{p.hash ? <Hash value={p.hash} label={`hash from ${p.title}`} /> : <span className="text-muted">not available</span>}</dd></div>
                <div className="flex gap-2"><dt className="w-16 text-muted">prevHash</dt><dd>{p.prevHash ? <Hash value={p.prevHash} label={`prevHash from ${p.title}`} /> : <span className="text-muted">not available</span>}</dd></div>
              </dl>
              {!p.readsStorage && <p className="mt-2 text-xs text-muted">Does not read storage: this is the independent witness.</p>}
            </article>
          );
        })}
      </div>
      <p role="status" aria-label="Read-back result" className={`text-sm ${cmp.agree ? "text-intact" : "text-tampered"}`}>
        {cmp.agree
          ? "✔ All three agree."
          : cmp.outliers.includes("log")
            ? "✘ The event log disagrees with storage. The first two read the same storage, so they agree with each other; only the log still holds what was originally written."
            : `✘ The ${cmp.outliers.map((o) => cmp.paths.find((p) => p.id === o)!.title.toLowerCase()).join(" and ")} disagree${cmp.outliers.length === 1 ? "s" : ""} with the others.`}
      </p>
    </section>
  );
}
