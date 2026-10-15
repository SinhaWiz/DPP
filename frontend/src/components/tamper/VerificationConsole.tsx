import { useState } from "react";
import type { ApiVerify, ApiVerifyRange } from "@dpp/shared";
import { Minimap } from "@/components/chain/Minimap";
import { useBrowserVerification } from "@/lib/useVerification";
import { getLiveController, useLive } from "@/store/live";
import { VerdictTable } from "./VerdictTable";

type Shown =
  | { kind: "ledger"; verify: ApiVerify }
  | { kind: "audit"; verify: ApiVerify }
  | { kind: "browser" }
  | { kind: "all"; verify: ApiVerify }
  | { kind: "range"; range: ApiVerifyRange };

/** Run each check yourself, on the whole ledger or on a slice, and compare the answers. */
export function VerificationConsole() {
  const length = useLive((s) => s.records.length);
  const { result } = useBrowserVerification();
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState<number | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = Math.min(to ?? length, length);
  const start = Math.min(from, end);

  const run = async (fn: () => Promise<Shown>) => {
    setBusy(true);
    setError(null);
    try {
      setShown(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const api = () => getLiveController().api;

  const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40";
  return (
    <section aria-label="Verification console" className="space-y-3">
      <h2 className="text-lg font-semibold">Check the ledger yourself</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={btn} onClick={() => void run(async () => ({ kind: "ledger", verify: await api().verify() }))}>verifyLedger()</button>
        <button type="button" disabled={busy} className={btn} onClick={() => void run(async () => ({ kind: "audit", verify: await api().verify() }))}>auditRange(0, {length})</button>
        <button type="button" disabled={busy} className={btn} onClick={() => setShown({ kind: "browser" })}>Full audit in your browser</button>
        <button type="button" disabled={busy} className={btn} onClick={() => void run(async () => ({ kind: "all", verify: await api().verify() }))}>Compare all three</button>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-medium">Check only part of the chain: <code>verifyRange(from, to)</code></p>
        <Minimap checks={result.checks} visible={end > start ? [start, end - 1] : undefined} onJump={(i) => { setFrom(i); setTo(Math.min(length, i + 3)); }} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">From record #{start}
            <input type="range" min={0} max={length} value={start} onChange={(e) => setFrom(Number(e.target.value))} className="w-full" aria-label="From" />
          </label>
          <label className="text-sm">Up to (not including) #{end}
            <input type="range" min={0} max={length} value={end} onChange={(e) => setTo(Number(e.target.value))} className="w-full" aria-label="To" />
          </label>
        </div>
        <button type="button" disabled={busy || length === 0} className={`${btn} mt-2`} onClick={() => void run(async () => ({ kind: "range", range: await api().verifyRange(start, end) }))}>
          verifyRange({start}, {end})
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-tampered">{error}</p>}

      <div aria-live="polite" aria-label="Console result">
        {shown?.kind === "ledger" && <LedgerResult verify={shown.verify} />}
        {shown?.kind === "audit" && <AuditResult verify={shown.verify} />}
        {shown?.kind === "browser" && <BrowserResult />}
        {shown?.kind === "all" && <VerdictTable verify={shown.verify} browser={result} />}
        {shown?.kind === "range" && <RangeResult range={shown.range} />}
      </div>
    </section>
  );
}

function LedgerResult({ verify }: { verify: ApiVerify }) {
  const c = verify.onChain;
  if (!c) return <p className="text-muted">The contract is not available.</p>;
  return (
    <p className={c.valid ? "text-intact" : "text-tampered"}>
      <code>verifyLedger()</code> → <strong>{c.valid ? "(true, 0): the contract says the ledger is intact." : `(false, ${c.brokenAt}): the first broken record is #${c.brokenAt}.`}</strong>
      {!c.valid && <span className="text-muted"> It stops at the first problem and does not say whether there are more.</span>}
    </p>
  );
}

function AuditResult({ verify }: { verify: ApiVerify }) {
  const c = verify.onChain;
  if (!c) return <p className="text-muted">The contract is not available.</p>;
  if (c.audit.brokenIndexes.length === 0) return <p className="text-intact"><code>auditRange</code> → <strong>no broken records.</strong></p>;
  return (
    <div className="text-tampered">
      <p><code>auditRange</code> → <strong>{c.audit.brokenIndexes.length} broken record{c.audit.brokenIndexes.length === 1 ? "" : "s"}</strong></p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {c.audit.brokenIndexes.map((i, n) => (
          <li key={i}>#{i}: {c.audit.reasons[n]! & 1 ? "data does not match its hash" : ""}{(c.audit.reasons[n]! & 3) === 3 ? " and " : ""}{c.audit.reasons[n]! & 2 ? "link does not match the previous hash" : ""}</li>
        ))}
      </ul>
    </div>
  );
}

function BrowserResult() {
  const { result } = useBrowserVerification();
  if (result.valid) return <p className="text-intact">Your browser recomputed every hash, followed every link and compared with the event log: <strong>all {result.checks.length} records are intact.</strong></p>;
  return (
    <div className="text-tampered">
      <p>Your browser recomputed every hash, followed every link and compared with the event log: <strong>{result.brokenIndexes.length} problem{result.brokenIndexes.length === 1 ? "" : "s"}.</strong></p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {result.checks.filter((c) => c.status !== "intact").map((c) => (
          <li key={String(c.index)}>#{String(c.index)}: {c.reasons.join(" ")}</li>
        ))}
      </ul>
    </div>
  );
}

function RangeResult({ range }: { range: ApiVerifyRange }) {
  const { contract, offChain } = range;
  const hidden = offChain.brokenIndexes.filter((i) => !contract.audit.brokenIndexes.includes(i));
  return (
    <div className="space-y-1 text-sm">
      <p className={contract.valid ? "text-intact" : "text-tampered"}>
        <code>verifyRange({range.from}, {range.to})</code> → <strong>{contract.valid ? "intact" : `first broken record #${contract.brokenAt}`}</strong>
      </p>
      <p className={offChain.valid ? "text-intact" : "text-tampered"}>
        Your browser, same records: <strong>{offChain.valid ? "intact" : `broken: ${offChain.brokenIndexes.map((i) => `#${i}`).join(", ")}`}</strong>
      </p>
      {hidden.length > 0 && <p className="rounded-md bg-surface-2 p-2">The contract cannot see {hidden.map((i) => `#${i}`).join(", ")}: they pass its data and link checks, but differ from the event log.</p>}
      {range.from === range.to && <p className="text-muted">An empty range has nothing to check, so it is always valid.</p>}
      <p className="text-muted">A range check only looks at the records inside it. A problem just outside is invisible to it.</p>
    </div>
  );
}
