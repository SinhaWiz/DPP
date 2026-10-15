import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ApiRecord, VerificationResult } from "@dpp/shared";
import { useSelection } from "@/store/selection";
import { BlockCard, CARD_W, CARD_W_COMPACT, LINK_W } from "./BlockCard";
import { useStatusEffects } from "@/lib/statusEffects";
import { FreshWrapper, useFreshRecords } from "./Fresh";
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
  /** Smaller cards, to see more of the chain at once. */
  compact?: boolean;
  /** Show which Ethereum block each record was written in (the chain underneath the ledger). */
  showBlocks?: boolean;
  /** Animate records that arrive after the view was first shown. */
  animate?: boolean;
  /** Animate changes in a record's verdict (cracks, snapped links, seals, repairs). */
  effects?: boolean;
  /** Reports the range of records on screen. */
  onVisibleRange?: (range: [number, number]) => void;
}

export interface ChainStripHandle {
  /** Scrolls a record into view and moves keyboard focus to it. */
  scrollToRecord(index: number): void;
}

/**
 * The whole ledger as a horizontal chain of blocks. Only the blocks on screen are rendered, so a
 * thousand records are as cheap as ten. It follows the newest record until you scroll away.
 */
export const ChainStrip = forwardRef<ChainStripHandle, ChainStripProps>(function ChainStrip(
  { records, verification, renderCard, initialWidth = 1200, compact = false, showBlocks = false, animate = true, effects: showEffects = true, onVisibleRange },
  handle,
) {
  const cardW = compact ? CARD_W_COMPACT : CARD_W;
  const fresh = useFreshRecords(records, animate);
  const fx = useStatusEffects(verification.checks, showEffects);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selected, select, productFilter } = useSelection();
  const [focus, setFocus] = useState(0);
  const [following, setFollowing] = useState(true);

  // item 0 is the genesis marker; item k (k >= 1) is record k-1
  const count = records.length + 1;
  const size = useCallback((i: number) => (i === 0 ? GENESIS_W + LINK_W : cardW + LINK_W), [cardW]);
  const virtualizer = useVirtualizer({
    horizontal: true,
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: size,
    overscan: 4,
    initialRect: { width: initialWidth, height: 180 },
  });

  // sizes changed (zoom): measure again
  useEffect(() => { virtualizer.measure(); }, [cardW, virtualizer]);

  const items = virtualizer.getVirtualItems();

  useImperativeHandle(handle, () => ({
    scrollToRecord(index: number) {
      const clamped = Math.max(0, Math.min(records.length - 1, index));
      setFollowing(false);
      setFocus(clamped);
      virtualizer.scrollToIndex(clamped + 1, { align: "center" });
      requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>(`[data-record="${clamped}"]`)?.focus());
    },
  }), [records.length, virtualizer]);

  const first = items.find((v) => v.index > 0)?.index;
  const last = [...items].reverse().find((v) => v.index > 0)?.index;
  useEffect(() => {
    if (first !== undefined && last !== undefined) onVisibleRange?.([first - 1, last - 1]);
  }, [first, last, onVisibleRange]);
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
        style={{ height: showBlocks ? 208 : 180 }}
      >
        <div style={{ width: totalWidth, height: "100%", position: "relative" }}>
          {items.map((item) => {
            const isGenesis = item.index === 0;
            const rec = isGenesis ? null : records[item.index - 1]!;
            const idx = item.index - 1;
            return (
              <div key={item.key} data-index={item.index} style={{ position: "absolute", left: item.start, top: 0 }} className="flex flex-col">
                {showBlocks && !isGenesis && (
                  <BlockLabel
                    block={rec!.blockNumber}
                    continued={idx > 0 && records[idx - 1]!.blockNumber === rec!.blockNumber}
                    width={cardW}
                  />
                )}
                <div className="flex items-center">
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
                          compact={compact}
                          fresh={fresh.has(rec!.index)}
                          effect={fx.cards.get(idx)}
                          data-record={idx}
                          onFocus={() => setFocus(idx)}
                          onSelect={() => select(BigInt(rec!.index))}
                        />
                      );
                      const wrapped = renderCard ? renderCard(card, rec!) : card;
                      return <FreshWrapper fresh={fresh.has(rec!.index)}>{wrapped}</FreshWrapper>;
                    })()}
                    {idx < records.length - 1 && <ChainLink ok={linkOk[idx + 1] ?? true} from={BigInt(rec!.index)} fresh={fresh.has(records[idx + 1]!.index)} effect={fx.links.get(idx + 1)} />}
                  </>
                )}
                </div>
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
});

/** A tag above a block naming the Ethereum block it was mined in; records of one block share a bracket. */
function BlockLabel({ block, continued, width }: { block: number | null; continued: boolean; width: number }) {
  return (
    <div
      data-lane-block={block ?? ""}
      className="flex h-7 items-end text-[11px] text-muted"
      style={{ width: width + LINK_W }}
    >
      <span className={`flex h-5 items-center border-t-2 border-neutral/60 ${continued ? "" : "rounded-tl-md border-l-2 pl-1.5"}`} style={{ width: continued ? width + LINK_W : width }}>
        {continued ? <span className="sr-only">same Ethereum block</span> : <>Ethereum block <span className="ml-1 font-mono text-text">{block ?? "?"}</span></>}
      </span>
    </div>
  );
}
