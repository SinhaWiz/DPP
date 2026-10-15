import { useCallback, useEffect, useState } from "react";
import { getLiveController, useLive } from "@/store/live";

export interface Attack {
  groupId: string;
  mode: string;
  createdAt: number;
  writes: { recordIndex: string; field: string; slot: string; oldValue: string; newValue: string }[];
}

/** The storage edits currently in effect, oldest first. Reloads when the lab reports a change. */
export function useAttacks() {
  const epoch = useLive((s) => s.epoch);
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAttacks((await getLiveController().api.lab.attacks()).attacks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [epoch, reload]);
  return { attacks, error, reload };
}
