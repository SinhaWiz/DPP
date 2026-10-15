import { VERIFICATION_META, type ApiRecord, type RecordCheck } from "@dpp/shared";
import { Address, ActionBadge, Eth, Hash, LifecyclePill } from "@/components/common/Primitives";
import { formatDateTime } from "@/lib/format";
import { useRecordDetail } from "@/lib/useRecordDetail";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 border-t border-border pt-2 first:mt-0 first:border-0 first:pt-0">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <dl className="space-y-0.5">{children}</dl>
    </section>
  );
}

const Mark = ({ ok }: { ok: boolean | null }) =>
  ok === null ? <span className="text-muted" aria-label="not checked">–</span> : ok ? <span className="text-intact" aria-label="passed">✔</span> : <span className="text-tampered" aria-label="failed">✘</span>;

/**
 * Everything about one block, on hover or focus: the record, the transaction that created it, and
 * each integrity check with the reason it passed or failed.
 */
export function BlockTooltip({ record, check }: { record: ApiRecord; check: RecordCheck | undefined }) {
  const { detail, loading, error } = useRecordDetail(record.index);
  const tx = detail?.tx ?? null;
  const verdict = VERIFICATION_META[check?.status ?? "intact"];

  return (
    <div className="w-80 text-sm">
      <Section title="Record">
        <Row label="Action"><ActionBadge action={record.action as 0} /></Row>
        <Row label="Product">{record.productName ?? "—"} <span className="text-muted">#{record.productId}</span></Row>
        <Row label={record.action === 3 ? "Seller" : "Actor"}><Address value={record.actor} /></Row>
        {record.counterparty !== "0x" + "00".repeat(20) && <Row label={record.action === 3 ? "Buyer" : "Other party"}><Address value={record.counterparty} /></Row>}
        {BigInt(record.price) > 0n && <Row label="Price"><Eth wei={record.price} /></Row>}
        <Row label="Time">{formatDateTime(record.timestamp)} <span className="text-muted">({record.timestamp})</span></Row>
        <Row label="prevHash"><Hash value={record.prevHash} label="prevHash" /></Row>
        <Row label="hash"><Hash value={record.hash} label="hash" /></Row>
      </Section>

      <Section title="Transaction that created it">
        {loading && !tx && <p className="text-muted">Loading…</p>}
        {error && <p className="text-tampered">Could not load: {error}</p>}
        {!loading && !error && !tx && <p className="text-muted">Not known to the index.</p>}
        {tx && (
          <>
            <Row label="Hash"><Hash value={tx.hash} label="Transaction hash" /></Row>
            <Row label="Call"><code className="font-mono text-xs">{tx.functionName ?? "—"}({tx.args ? Object.values(tx.args).join(", ") : ""})</code></Row>
            <Row label="Block">{tx.blockNumber ?? "—"}</Row>
            <Row label="Status"><LifecyclePill state={tx.state} /></Row>
            {tx.gasUsed && <Row label="Gas used">{Number(tx.gasUsed).toLocaleString()}</Row>}
            {tx.minedAt != null && <Row label="Pending→mined">{Math.max(0, tx.minedAt - tx.firstSeenAt)} ms</Row>}
          </>
        )}
      </Section>

      <Section title="Integrity">
        <Row label="Verdict"><span className="font-medium">{verdict.icon} {verdict.label}</span></Row>
        <Row label="Data"><Mark ok={check?.dataOk ?? null} /> hash matches the record's fields</Row>
        <Row label="Link"><Mark ok={check?.linkOk ?? null} /> prevHash matches the previous hash</Row>
        <Row label="Event log"><Mark ok={check?.anchorOk ?? null} /> agrees with the RecordAppended event</Row>
        {check?.reasons.map((r) => (
          <p key={r} className="mt-1 text-xs text-tampered">{r}</p>
        ))}
      </Section>
    </div>
  );
}
