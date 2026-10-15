import { useEffect, useState } from "react";
import type { ApiStorageRecord } from "@dpp/shared";
import { getLiveController, useLive } from "@/store/live";

export interface StorageState {
  data: ApiStorageRecord | null;
  loading: boolean;
  error: string | null;
}

/** One record's raw storage slots next to their decoded values; reloads when history may have changed. */
export function useStorageRecord(index: string | null): StorageState {
  const epoch = useLive((s) => s.epoch);
  const [state, setState] = useState<StorageState>({ data: null, loading: index !== null, error: null });

  useEffect(() => {
    if (index === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ data: s.data?.index === index ? s.data : null, loading: true, error: null }));
    getLiveController()
      .api.storageRecord(index)
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((e) => !cancelled && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => { cancelled = true; };
  }, [index, epoch]);

  return state;
}
