import { useEffect, useState } from "react";
import type { ApiProductTrail } from "@dpp/shared";
import { getLiveController, useLive } from "@/store/live";

export interface TrailState {
  trail: ApiProductTrail | null;
  loading: boolean;
  error: string | null;
}

/** One product's ownership timeline; reloads when the ledger grows or changes. */
export function useProductTrail(productId: string | null): TrailState {
  const version = useLive((s) => `${s.records.length}:${s.verify?.offChain.firstBrokenAt ?? ""}`);
  const [state, setState] = useState<TrailState>({ trail: null, loading: productId !== null, error: null });

  useEffect(() => {
    if (productId === null) {
      setState({ trail: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ trail: s.trail?.product.id === productId ? s.trail : null, loading: true, error: null }));
    getLiveController()
      .api.trail(productId)
      .then((trail) => !cancelled && setState({ trail, loading: false, error: null }))
      .catch((e) => !cancelled && setState({ trail: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => { cancelled = true; };
  }, [productId, version]);

  return state;
}
