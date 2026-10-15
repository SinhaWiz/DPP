import { useRef, useState } from "react";
import { BlockTooltip } from "@/components/chain/BlockTooltip";
import { ChainControls } from "@/components/chain/ChainControls";
import { ChainStrip, type ChainStripHandle } from "@/components/chain/ChainStrip";
import { Minimap } from "@/components/chain/Minimap";
import { RecordDetail } from "@/components/chain/RecordDetail";
import { Tooltip } from "@/components/common/Tooltip";
import { EmptyState } from "@/components/layout/Panels";
import { useBrowserVerification } from "@/lib/useVerification";
import { useLive } from "@/store/live";
import { useSelection } from "@/store/selection";

export function Explorer() {
  const records = useLive((s) => s.records);
  const products = useLive((s) => s.products);
  const loaded = useLive((s) => s.loaded);
  const { result } = useBrowserVerification();
  const { selected, select, productFilter, setProductFilter } = useSelection();
  const strip = useRef<ChainStripHandle>(null);
  const [compact, setCompact] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [visible, setVisible] = useState<[number, number] | undefined>();

  const selectedRecord = selected === null ? null : (records.find((r) => BigInt(r.index) === selected) ?? null);

  const jump = (i: number) => {
    strip.current?.scrollToRecord(i);
    select(BigInt(i));
  };

  return (
    <div className="mx-auto max-w-full">
      <h1 className="text-xl font-semibold">Explorer</h1>
      <p className="mb-4 text-muted">The ledger as a chain of blocks. Hover a block to see what it holds.</p>

      {!loaded ? (
        <EmptyState title="Loading the chain…" />
      ) : (
        <>
          <ChainControls
            recordCount={records.length}
            products={products}
            productFilter={productFilter}
            compact={compact}
            showBlocks={showBlocks}
            onJump={jump}
            onProductFilter={setProductFilter}
            onCompact={setCompact}
            onShowBlocks={setShowBlocks}
          />
          <ChainStrip
            ref={strip}
            records={records}
            verification={result}
            compact={compact}
            showBlocks={showBlocks}
            onVisibleRange={setVisible}
            renderCard={(card, record) => (
              <Tooltip content={<BlockTooltip record={record} check={result.checks[Number(record.index)]} />} placement="top" delay={250}>
                {card}
              </Tooltip>
            )}
          />
          <div className="mt-1">
            <Minimap checks={result.checks} visible={visible} onJump={jump} />
          </div>
        </>
      )}

      {selectedRecord && (
        <RecordDetail
          record={selectedRecord}
          previous={records[Number(selectedRecord.index) - 1] ?? null}
          check={result.checks[Number(selectedRecord.index)]}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}
