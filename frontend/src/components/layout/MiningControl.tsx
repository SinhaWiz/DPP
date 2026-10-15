import { useState } from "react";
import { getLiveController, useLive } from "@/store/live";

const SLOW_MS = 3000;

/**
 * How the local chain mines. Automatic: each transaction is mined at once. Step: transactions wait in
 * the mempool until you mine a block. Slow motion: a block every few seconds. Only on the local chain.
 */
export function MiningControl() {
  const { mining, lab, pending } = useLive((s) => ({
    mining: s.mining,
    lab: s.session?.lab ?? null,
    pending: s.txs.filter((t) => t.state === "pending").length,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lab || !lab.available || !mining) {
    return lab && !lab.available ? <span className="text-sm text-muted" title={lab.reason ?? undefined}>Mining: not controllable here</span> : null;
  }

  const api = getLiveController().api;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await getLiveController().flush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const modes: { id: "auto" | "manual" | "interval"; label: string; hint: string }[] = [
    { id: "auto", label: "Auto", hint: "Every transaction is mined immediately" },
    { id: "manual", label: "Step", hint: "Transactions wait until you mine a block" },
    { id: "interval", label: "Slow", hint: `A block every ${SLOW_MS / 1000} seconds` },
  ];

  return (
    <div className="flex items-center gap-2 text-sm">
      <div role="group" aria-label="Mining mode" className="inline-flex overflow-hidden rounded-md border border-border">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy}
            title={m.hint}
            aria-pressed={mining.mode === m.id}
            onClick={() => void run(() => api.lab.setMining(m.id, m.id === "interval" ? SLOW_MS : undefined))}
            className={`px-2.5 py-1 ${mining.mode === m.id ? "bg-accent text-white" : "hover:bg-surface-2"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || mining.mode !== "manual"}
        onClick={() => void run(() => api.lab.mine(1))}
        title={mining.mode === "manual" ? "Mine one block now" : "Switch to Step mode to mine by hand"}
        className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40"
      >
        Mine block{pending > 0 && mining.mode === "manual" ? ` (${pending} waiting)` : ""}
      </button>
      {error && <span role="alert" className="max-w-[16rem] truncate text-tampered" title={error}>{error}</span>}
    </div>
  );
}
