import { useEffect, useRef, useState } from "react";
import { shortHash } from "@/lib/format";
import type { Attack } from "@/lib/useAttacks";
import { getLiveController } from "@/store/live";

export const ENTRY_SNAPSHOT = "lab-entry";

/** The warning that stays on screen for as long as the lab is open. */
export function TamperBanner() {
  return (
    <div role="note" className="rounded-lg border-2 border-pending bg-pending/10 p-3 text-sm">
      <p className="font-semibold text-pending">You are editing contract storage directly.</p>
      <p className="text-muted">
        This only works because this is a local development chain that you control. On a real network nobody can rewrite stored data like this, which is exactly why a blockchain is trustworthy.
        Everything here can be undone.
      </p>
    </div>
  );
}

/**
 * Takes a snapshot the first time the lab opens, so "Restore everything" always has somewhere to
 * return to. Returns whether that snapshot exists.
 */
export function useEntrySnapshot(enabled: boolean): { ready: boolean; error: string | null } {
  const taken = useRef(false);
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });
  useEffect(() => {
    if (!enabled || taken.current) return;
    taken.current = true;
    getLiveController()
      .api.lab.snapshot(ENTRY_SNAPSHOT)
      .then(() => setState({ ready: true, error: null }))
      .catch((e) => {
        taken.current = false;
        setState({ ready: false, error: e instanceof Error ? e.message : String(e) });
      });
  }, [enabled]);
  return state;
}

export interface SafetyBarProps {
  attacks: Attack[];
  snapshotReady: boolean;
  onChanged(): void;
}

/** Ways back: undo the latest attack, undo them all, or restore the chain to how it was on entering. */
export function SafetyBar({ attacks, snapshotReady, onChanged }: SafetyBarProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = attacks.at(-1);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(label);
      await getLiveController().flush();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const api = getLiveController().api;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={busy || !last} onClick={() => last && void run("Last attack undone.", () => api.lab.undo(last.groupId))} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40">
        Undo last attack
      </button>
      <button type="button" disabled={busy || attacks.length === 0} onClick={() => void run("Every attack undone.", () => api.lab.undoAll())} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40">
        Undo all
      </button>
      <button
        type="button"
        disabled={busy || !snapshotReady}
        title="Return the whole chain to how it was when you opened the lab"
        onClick={() => void run("The chain is back to how it was when you opened the lab.", () => api.lab.restore(ENTRY_SNAPSHOT))}
        className="rounded-md border border-pending px-3 py-1.5 text-pending hover:bg-surface-2 disabled:opacity-40"
      >
        Restore everything
      </button>
      <span aria-live="polite" className="text-intact">{message}</span>
      {error && <span role="alert" className="text-tampered">{error}</span>}
    </div>
  );
}

/** What has been changed and not yet undone. */
export function AttackJournal({ attacks }: { attacks: Attack[] }) {
  return (
    <section aria-label="Active attacks" className="rounded-lg border border-border p-3">
      <h3 className="mb-1 text-sm font-semibold">Active attacks</h3>
      {attacks.length === 0 ? (
        <p className="text-sm text-muted">None. The stored data is exactly what the contract wrote.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {attacks.map((a, i) => (
            <li key={a.groupId} className="rounded border border-border px-2 py-1">
              <span className="font-medium">#{i + 1} {a.mode}</span>
              <span className="text-muted"> · {a.writes.length} write{a.writes.length === 1 ? "" : "s"}: </span>
              <span className="font-mono text-xs">
                {a.writes.map((w) => `#${w.recordIndex}.${w.field}`).join(", ")}
              </span>
              <span className="ml-2 font-mono text-xs text-muted" title={a.groupId}>{shortHash(a.groupId, 6, 0)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
