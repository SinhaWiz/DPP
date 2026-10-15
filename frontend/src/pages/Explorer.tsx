import { EmptyState } from "@/components/layout/Panels";
import { ChainStrip } from "@/components/chain/ChainStrip";
import { useBrowserVerification } from "@/lib/useVerification";
import { useLive } from "@/store/live";

export function Explorer() {
  const records = useLive((s) => s.records);
  const loaded = useLive((s) => s.loaded);
  const { result } = useBrowserVerification();

  return (
    <div className="mx-auto max-w-full">
      <h1 className="text-xl font-semibold">Explorer</h1>
      <p className="mb-4 text-muted">The ledger as a chain of blocks. Hover a block to see what it holds.</p>
      {!loaded ? (
        <EmptyState title="Loading the chain…" />
      ) : (
        <ChainStrip records={records} verification={result} />
      )}
    </div>
  );
}
