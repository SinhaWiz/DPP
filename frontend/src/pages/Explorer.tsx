import { EmptyState } from "@/components/layout/Panels";
import { BlockTooltip } from "@/components/chain/BlockTooltip";
import { ChainStrip } from "@/components/chain/ChainStrip";
import { Tooltip } from "@/components/common/Tooltip";
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
        <ChainStrip
          records={records}
          verification={result}
          renderCard={(card, record) => (
            <Tooltip content={<BlockTooltip record={record} check={result.checks[Number(record.index)]} />} placement="top" delay={250}>
              {card}
            </Tooltip>
          )}
        />
      )}
    </div>
  );
}
