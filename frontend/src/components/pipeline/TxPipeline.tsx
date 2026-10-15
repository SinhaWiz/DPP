import { useEffect, useState } from "react";
import { focusNode, pipelineNodes, type NodeKey, type NodeStatus, type PipelineNode } from "@/lib/pipeline";
import { shortHash } from "@/lib/format";
import { useFlow } from "@/store/flowInstance";
import { EmptyState } from "@/components/layout/Panels";
import { formatTime } from "@/lib/format";

const STYLE: Record<NodeStatus, { ring: string; text: string; icon: string }> = {
  done: { ring: "border-intact bg-intact/15", text: "text-intact", icon: "✔" },
  current: { ring: "border-pending pulse-ring bg-pending/15", text: "text-pending", icon: "●" },
  failed: { ring: "border-tampered bg-tampered/15", text: "text-tampered", icon: "✘" },
  upcoming: { ring: "border-border border-dashed", text: "text-muted", icon: "○" },
};

const STATUS_WORD: Record<NodeStatus, string> = { done: "done", current: "in progress", failed: "failed", upcoming: "not reached yet" };

/** The life of one transaction as a row of stages. Click a stage to see its data and what it means. */
export function TxPipeline() {
  const tx = useFlow((s) => s.items.find((t) => t.id === s.activeId) ?? null);
  const [picked, setPicked] = useState<NodeKey | null>(null);

  // a different transaction starts with no stage picked
  const id = tx?.id;
  useEffect(() => setPicked(null), [id]);

  if (!tx) {
    return <EmptyState title="No transaction yet" hint="Choose an action on the left and press Send. Every step it goes through appears here." />;
  }

  const nodes = pipelineNodes(tx);
  const shown: PipelineNode = nodes.find((n) => n.key === picked) ?? focusNode(nodes);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-medium">{tx.label}</h2>
        <span className="text-sm text-muted">as {tx.fromRole ?? shortHash(tx.from)}</span>
        {tx.hash && <span className="font-mono text-xs text-muted" title={tx.hash}>{shortHash(tx.hash)}</span>}
        {tx.forced && <span className="rounded-full border border-pending px-2 text-xs text-pending">sent anyway</span>}
      </header>

      <ol aria-label="Transaction stages" className="flex flex-wrap items-center gap-y-2">
        {nodes.map((n, i) => {
          const st = STYLE[n.status];
          const isShown = n.key === shown.key;
          return (
            <li key={n.key} className="flex items-center">
              {i > 0 && <span aria-hidden className={`mx-1 h-0.5 w-5 sm:w-8 ${n.status === "upcoming" ? "bg-border" : "bg-muted/50"}`} />}
              <button
                type="button"
                onClick={() => setPicked(n.key)}
                aria-current={n.status === "current" ? "step" : undefined}
                aria-pressed={isShown}
                aria-label={`${n.label}: ${STATUS_WORD[n.status]}`}
                className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-sm ${st.ring} ${isShown ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""}`}
              >
                <span aria-hidden className={`font-bold ${st.text}`}>{st.icon}</span>
                <span className={n.status === "upcoming" ? "text-muted" : ""}>{n.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section aria-label={`Details: ${shown.label}`} aria-live="polite" className="rounded-lg border border-border p-3">
        <h3 className="mb-1 flex items-center gap-2 font-medium">
          <span className={STYLE[shown.status].text} aria-hidden>{STYLE[shown.status].icon}</span>
          {shown.label}
          {shown.at != null && <span className="text-xs font-normal text-muted">{formatTime(shown.at, "ms")}</span>}
        </h3>
        <p className="mb-2 text-sm text-muted">{shown.explain}</p>
        {shown.detail.length > 0 && (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-sm">
            {shown.detail.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="break-all font-mono text-xs leading-5">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
