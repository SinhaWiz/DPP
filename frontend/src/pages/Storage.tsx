import { useSearchParams } from "react-router-dom";
import { WriteCost, ReadBack } from "@/components/storage/CostAndReadback";
import { SlotMaths, SlotView } from "@/components/storage/SlotView";
import { EmptyState } from "@/components/layout/Panels";
import { useStorageRecord } from "@/lib/useStorageRecord";
import { useLive } from "@/store/live";

export function StoragePage() {
  const records = useLive((s) => s.records);
  const loaded = useLive((s) => s.loaded);
  const [params, setParams] = useSearchParams();
  const wanted = params.get("record");
  const index = wanted !== null && /^\d+$/.test(wanted) && Number(wanted) < records.length ? wanted : null;
  const { data, loading, error } = useStorageRecord(index);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Storage</h1>
        <p className="text-muted">Where a record lives in the contract's storage, what writing it cost, and three independent ways to read it back.</p>
      </div>

      {!loaded ? (
        <EmptyState title="Loading…" />
      ) : records.length === 0 ? (
        <EmptyState title="The ledger is empty" hint="Register a product and its record will appear here." />
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Record</span>
            <select
              value={index ?? ""}
              onChange={(e) => setParams(e.target.value ? { record: e.target.value } : {})}
              className="rounded-md border border-border bg-surface px-2 py-1"
            >
              <option value="">Choose a record…</option>
              {records.map((r) => (
                <option key={r.index} value={r.index}>#{r.index} · {r.actionLabel} · {r.productName ?? `product ${r.productId}`}</option>
              ))}
            </select>
          </label>

          {index === null && <EmptyState title="Select a record to inspect its slots" hint="You can also arrive here from a record's detail panel." />}
          {index !== null && loading && !data && <EmptyState title="Reading storage…" />}
          {error && <p role="alert" className="text-tampered">{error}</p>}
          {data && (
            <>
              <SlotView data={data} />
              <SlotMaths data={data} />
              <WriteCost data={data} />
              <ReadBack data={data} />
            </>
          )}
        </>
      )}
    </div>
  );
}
