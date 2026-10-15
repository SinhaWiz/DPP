import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiRecord, VerificationResult } from "@dpp/shared";
import { useSelection } from "@/store/selection";
import { BlockCard, CARD_W, LINK_W } from "./BlockCard";
import { ChainLink, GenesisMarker } from "./ChainLink";

const GENESIS_W = 120;
/** Distance from the end that still counts as "following the newest record". */
const FOLLOW_SLACK = CARD_W;

export interface ChainStripProps {
  records: ApiRecord[];
  /** The browser's verification result; its checks line up with `records`. */
  verification: VerificationResult;
  /** Wraps a card, e.g. in a hover tooltip. */
  renderCard?: (card: React.ReactElement, record: ApiRecord) => React.ReactElement;
  /** Size to assume before the browser has measured the strip (tests, first paint). */
  initialWidth?: number;
}

/**
 * The whole ledger as a horizontal chain of blocks. Only the blocks on screen are rendered, so a
 * thousand records are as cheap as ten. It follows the newest record until you scroll away.
 */
export function ChainStrip({ records, verification, renderCard, initialWidth = 1200 }: ChainStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selected, select, productFilter } = useSelection();
  const [focus, setFocus] = useState(0);
  const [following, setFollowing] = useState(true);

  // item 0 is the genesis marker; item k (k >= 1) is record k-1
  const count = records.length + 1;
  const size = useCallback((i: number) => (i === 0 ? GENESIS_W + LINK_W : CARD_W + LINK_W), []);
  const virtualizer = useVirtualizer({
    horizontal: true,
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: size,
    overscan: 4,
    initialRect: { width: initialWidth, height: 180 },
  });

  const items = virtualizer.getVirtualItems();
  const totalWidth = virtualizer.getTotalSize();

  // Follow the head: when records are added and the user was at the end, stay at the end.
  const lastCount = useRef(records.length);
  useEffect(() => {
    if (following && records.length !== lastCount.current && records.length > 0) {
      virtualizer.scrollToIndex(records.length, { align: "end" });
    }
    lastCount.current = records.length;
  }, [records.length, following, virtualizer]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFollowing(el.scrollWidth - el.scrollLeft - el.clientWidth <= FOLLOW_SLACK);
  }, []);

  const jumpToLatest = () => {
    setFollowing(true);
    if (records.length) virtualizer.scrollToIndex(records.length, { align: "end" });
  };

  // roving focus: one card is in the tab order; arrow keys move between cards
  const moveFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(records.length - 1, next));
    setFocus(clamped);
    virtualizer.scrollToIndex(clamped + 1, { align: "auto" });
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>(`[data-record="${clamped}"]`)?.focus());
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = 5;
    const map: Record<string, number> = {
      ArrowRight: focus + 1, ArrowLeft: focus - 1, Home: 0, End: records.length - 1, PageDown: focus + page, PageUp: focus - page,
    };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(map[e.key]!);
    }
  };

  const filtered = productFilter;
  const checks = verification.checks;
  const linkOk = useMemo(() => checks.map((c) => c.linkOk), [checks]);

  if (records.length === 0) {
    return (
      <div className="flex items-center gap-4 overflow-x-auto py-4" aria-label="Ledger chain">
        <GenesisMarker />
        <p className="text-sm text-muted">The chain is empty. Register a product and its first block appears here, linked to the genesis hash.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        role="group"
        aria-label="Ledger chain"
        aria-roledescription="chain of blocks"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="overflow-x-auto overflow-y-hidden pb-3 pt-1"
        style={{ height: 180 }}
      >
        <div style={{ width: totalWidth, height: "100%", position: "relative" }}>
          {items.map((item) => {
            const isGenesis = item.index === 0;
            const rec = isGenesis ? null : records[item.index - 1]!;
            const idx = item.index - 1;
            return (
              <div key={item.key} data-index={item.index} style={{ position: "absolute", left: item.start, top: 0 }} className="flex items-center">
                {isGenesis ? (
                  <>
                    <GenesisMarker />
                    <ChainLink ok={true} from={null} />
                  </>
                ) : (
                  <>
                    {(() => {
                      const card = (
                        <BlockCard
                          record={rec!}
                          check={checks[idx]}
                          selected={selected !== null && selected === BigInt(rec!.index)}
                          dimmed={filtered !== null && rec!.productId !== filtered}
                          focusable={focus === idx}
                          data-record={idx}
                          onFocus={() => setFocus(idx)}
                          onSelect={() => select(BigInt(rec!.index))}
                        />
                      );
                      return renderCard ? renderCard(card, rec!) : card;
                    })()}
                    {idx < records.length - 1 && <ChainLink ok={linkOk[idx + 1] ?? true} from={BigInt(rec!.index)} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!following && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute right-3 top-3 rounded-full border border-border bg-surface px-3 py-1 text-sm shadow-md hover:bg-surface-2"
        >
          Jump to latest →
        </button>
      )}
    </div>
  );
}
