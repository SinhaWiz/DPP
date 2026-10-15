import { useMemo, useState } from "react";
import type { ApiVerify } from "@dpp/shared";
import { useBrowserVerification } from "@/lib/useVerification";
import { LEVELS, levelInfo, type Level } from "@/lib/verdicts";
import { getLiveController, useLive } from "@/store/live";
import { VerdictTable } from "./VerdictTable";

const FIELDS = ["price", "timestamp", "productId", "action", "counterparty", "actor"] as const;
type Field = (typeof FIELDS)[number];

const DEFAULT_VALUE: Record<Field, string> = {
  price: "999", timestamp: "1", productId: "7", action: "2", counterparty: "0x0000000000000000000000000000000000000001", actor: "0x0000000000000000000000000000000000000002",
};

/** Guided attacks: predict the outcome, run it, then compare what the contract and the browser say. */
export function AttackLevels({ onChanged }: { onChanged(): void }) {
  const records = useLive((s) => s.records);
  const { result } = useBrowserVerification();
  const [level, setLevel] = useState<Level>(1);
  // Until the learner picks a record, aim at one in the middle of whatever chain exists now.
  const [picked, setPicked] = useState<number | null>(null);
  const [field, setField] = useState<Field>("price");
  const [value, setValue] = useState(DEFAULT_VALUE.price);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState<{ level: Level; verify: ApiVerify } | null>(null);

  const info = levelInfo(level);
  const last = records.length - 1;
  const index = Math.max(0, Math.min(last, picked ?? Math.floor(records.length / 2) - 1));
  const second = Math.min(last, index + 2);
  const needsMore = level === 4 && (records.length < 3 || index > last - 1);
  const setIndex = (n: number) => setPicked(Math.max(0, Math.min(last, n)));

  const pick = (l: Level) => { setLevel(l); setRan(null); setError(null); };
  const changeField = (f: Field) => { setField(f); setValue(DEFAULT_VALUE[f]); };

  const run = async () => {
    setBusy(true);
    setError(null);
    const live = getLiveController();
    try {
      await live.api.lab.tamper({ index, field, value, mode: info.mode });
      if (level === 4) await live.api.lab.tamper({ index: second, field, value, mode: "data" });
      await live.flush();
      setRan({ level, verify: await live.api.verify() });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const expectation = useMemo(() => info.expect(index, second), [info, index, second]);

  if (records.length === 0) return <p className="text-sm text-muted">Register a product first: there is nothing to attack in an empty ledger.</p>;

  return (
    <section aria-label="Attack levels" className="space-y-3">
      <div role="tablist" aria-label="Attack levels" className="flex flex-wrap gap-1">
        {LEVELS.map((l) => (
          <button key={l.level} role="tab" type="button" aria-selected={level === l.level} onClick={() => pick(l.level)}
            className={`rounded-md border px-3 py-1.5 text-sm ${level === l.level ? "border-accent bg-surface-2 font-medium" : "border-border hover:bg-surface-2"}`}>
            Level {l.level}: {l.title}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="space-y-3 rounded-lg border border-border p-3">
        <p><strong>The attack.</strong> {info.idea}</p>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col"><span className="text-xs text-muted">Record to attack</span>
            <input type="number" min={0} max={last} value={index} onChange={(e) => setIndex(Math.max(0, Math.min(last, Number(e.target.value) || 0)))} className="w-24 rounded-md border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col"><span className="text-xs text-muted">Field to change</span>
            <select value={field} onChange={(e) => changeField(e.target.value as Field)} className="rounded-md border border-border bg-surface px-2 py-1">
              {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="flex flex-col"><span className="text-xs text-muted">New value</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} className="w-56 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs" />
          </label>
          <button type="button" disabled={busy || needsMore} onClick={() => void run()} className="rounded-md bg-tampered px-3 py-1.5 font-medium text-white disabled:opacity-40">
            Run the attack
          </button>
        </div>
        {needsMore && <p className="text-sm text-pending">Level 4 needs two records to attack: pick an earlier record, or add more.</p>}

        <p className="rounded-md bg-surface-2 p-2 text-sm"><strong>Before you run it, predict:</strong> {expectation}</p>
        {error && <p role="alert" className="text-sm text-tampered">{error}</p>}

        {ran && ran.level === level && (
          <div className="space-y-2" aria-live="polite">
            <h3 className="font-semibold">What happened</h3>
            <VerdictTable verify={ran.verify} browser={result} />
            <p className="rounded-md border border-accent p-2 text-sm"><strong>The lesson.</strong> {info.lesson}</p>
          </div>
        )}
      </div>
    </section>
  );
}
