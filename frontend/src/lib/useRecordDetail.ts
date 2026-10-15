import { useEffect, useState } from "react";
import type { ApiRecordDetail } from "@dpp/shared";
import { getLiveController } from "@/store/live";

export interface DetailState {
  detail: ApiRecordDetail | null;
  loading: boolean;
  error: string | null;
}

/** Loads one record's full detail when a component needs it. */
export function useRecordDetail(index: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ detail: null, loading: index !== null, error: null });
  useEffect(() => {
    if (index === null) {
      setState({ detail: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ detail: s.detail?.index === index ? s.detail : null, loading: true, error: null }));
    getLiveController()
      .recordDetail(index)
      .then((detail) => !cancelled && setState({ detail, loading: false, error: null }))
      .catch((e) => !cancelled && setState({ detail: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => { cancelled = true; };
  }, [index]);
  return state;
}
