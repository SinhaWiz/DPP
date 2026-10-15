import { useState } from "react";
import { computeHash, type ApiRecord, type RecordCheck } from "@dpp/shared";
import { ActionBadge, Address, Eth, Hash, StatusPill } from "@/components/common/Primitives";
import { formatDateTime } from "@/lib/format";
import { useRecordDetail } from "@/lib/useRecordDetail";
import { apiToLedgerRecord } from "@/lib/verifyInBrowser";
import { useSelection } from "@/store/selection";
import { HashWalkthrough } from "./HashWalkthrough";

interface Props {
  record: ApiRecord;
  previous: ApiRecord | null;
  check: RecordCheck | undefined;
  onClose(): void;
}

/** Everything about one record, plus ways to check it with your own eyes. */
export function RecordDetail({ record, previous, check, onClose }: Props) {
  const { detail } = useRecordDetail(record.index);
  const setProductFilter = useSelection((s) => s.setProductFilter);
  const filter = useSelection((s) => s.productFilter);
  const [verified, setVerified] = useState<null | { dataOk: boolean; linkOk: boolean; recomputed: string }>(null);

  const verify = () => {
    const recomputed = computeHash(apiToLedgerRecord(record));
    setVerified({
      recomputed,
      dataOk: recomputed.toLowerCase() === record.hash.toLowerCase(),
      linkOk: previous ? record.prevHash.toLowerCase() === previous.hash.toLowerCase() : /^0x0+$/.test(record.prevHash),
    });
  };

  return (
    <section aria-label={`Record ${record.index} in detail`} className="mt-4 rounded-xl border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">Record #{record.index}</h2>
        <ActionBadge action={record.action as 0} />
        <StatusPill status={check?.status ?? "intact"} />
        <button type="button" onClick={onClose} className="ml-auto rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2">
          Close
        </button>
      </header>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Product</dt>
          <dd>{record.productName ?? "—"} <span className="text-muted">#{record.productId}</span></dd>
          <dt className="text-muted">{record.action === 3 ? "Seller" : "Actor"}</dt>
          <dd><Address value={record.actor} /></dd>
          <dt className="text-muted">{record.action === 3 ? "Buyer" : "Other party"}</dt>
          <dd><Address value={record.counterparty} /></dd>
          <dt className="text-muted">Price</dt>
          <dd>{BigInt(record.price) > 0n ? <Eth wei={record.price} /> : "—"}</dd>
          <dt className="text-muted">Time</dt>
          <dd>{formatDateTime(record.timestamp)}</dd>
          <dt className="text-muted">prevHash</dt>
          <dd><Hash value={record.prevHash} label="prevHash" /></dd>
          <dt className="text-muted">hash</dt>
          <dd><Hash value={record.hash} label="hash" /></dd>
          <dt className="text-muted">Created by</dt>
          <dd>
            {detail?.tx ? (
              <span>
                <Hash value={detail.tx.hash} label="Transaction hash" /> <span className="text-muted">in block {detail.tx.blockNumber}</span>
              </span>
            ) : (
              "—"
            )}
          </dd>
        </dl>

        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3">
            <h3 className="mb-1 font-medium">Verify it yourself</h3>
            <p className="mb-2 text-sm text-muted">Recompute this record's hash in your browser and compare it with what is stored and with the previous record.</p>
            <button type="button" onClick={verify} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
              Recompute now
            </button>
            {verified && (
              <ul className="mt-2 space-y-1 text-sm" role="status" aria-label="Verification result">
                <li className={verified.dataOk ? "text-intact" : "text-tampered"}>
                  {verified.dataOk ? "✔" : "✘"} Recomputed hash {verified.dataOk ? "equals" : "differs from"} the stored hash
                </li>
                <li className={verified.linkOk ? "text-intact" : "text-tampered"}>
                  {verified.linkOk ? "✔" : "✘"} prevHash {verified.linkOk ? "equals" : "does not equal"} the {previous ? `hash of record #${previous.index}` : "genesis hash (all zeros)"}
                </li>
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={() => setProductFilter(filter === record.productId ? null : record.productId)}
              className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2"
              aria-pressed={filter === record.productId}
            >
              {filter === record.productId ? "Show all products" : `Follow product #${record.productId}`}
            </button>
            <a className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2" href={`/storage?record=${record.index}`}>
              See its storage slots
            </a>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <HashWalkthrough record={record} />
      </div>
    </section>
  );
}
