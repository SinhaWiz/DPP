import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { LessonCtx } from "./types";
import { useFlow } from "@/store/flowInstance";
import { useLive } from "@/store/live";
import { useSelection } from "@/store/selection";
import { useTally } from "@/store/eventTally";
import { useWallet } from "@/store/wallet";
import { useBrowserVerification } from "@/lib/useVerification";

/** Reads the whole app into one object, so lesson steps can ask questions about it. */
export function useLessonCtx(): LessonCtx {
  const { pathname, search } = useLocation();
  const live = useLive((s) => ({ records: s.records.length, products: s.products.length, txs: s.txs, mining: s.mining?.mode ?? null }));
  const { selected, productFilter } = useSelection();
  const address = useWallet((s) => s.wallet?.address ?? null);
  const items = useFlow((s) => s.items);
  const activeId = useFlow((s) => s.activeId);
  const tally = useTally();
  const { result } = useBrowserVerification();

  return useMemo<LessonCtx>(() => {
    const reached = (...stages: string[]) => items.filter((t) => t.history.some((h) => stages.includes(h.stage))).length;
    const active = items.find((t) => t.id === activeId);
    return {
      route: pathname,
      search,
      records: live.records,
      products: live.products,
      txCount: live.txs.length,
      failedTxs: live.txs.filter((t) => t.state === "failed").length,
      pendingTxs: live.txs.filter((t) => t.state === "pending").length,
      mining: live.mining,
      selected,
      followedProduct: productFilter,
      actingAs: address ? address.toLowerCase() : null,
      activeStage: active?.stage ?? null,
      reached: { simulated: reached("simulated", "simfail"), pending: reached("pending"), mined: reached("mined"), failed: reached("failed"), revoked: items.filter((t) => t.fn === "revokeReservation" || t.fn === "rejectReservation" || t.fn === "expireReservation").length },
      minedByFn: items.reduce<Record<string, number>>((acc, t) => (t.history.some((h) => h.stage === "mined") ? { ...acc, [t.fn]: (acc[t.fn] ?? 0) + 1 } : acc), {}),
      verifyValid: result.valid,
      brokenRecords: result.brokenIndexes.length,
      tampers: tally.tampers,
      restores: tally.restores,
      fooled: tally.fooled,
      events: tally.events,
    };
  }, [pathname, search, live, selected, productFilter, address, items, activeId, tally.tampers, tally.restores, tally.fooled, tally.events, result]);
}
