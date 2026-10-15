import type { ApiVerify, VerificationResult } from "@dpp/shared";
import { explainDifferences, verdictRows } from "@/lib/verdicts";

/** What the contract and your browser each say about the ledger right now, and why they differ. */
export function VerdictTable({ verify, browser }: { verify: ApiVerify | null; browser: VerificationResult }) {
  if (!verify) return <p className="text-sm text-muted">Reading the contract's verdict…</p>;
  const rows = verdictRows(verify, browser);
  const notes = explainDifferences(verify, browser);
  return (
    <div aria-label="Verdicts" className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr><th className="pr-3 font-normal">Who checked</th><th className="pr-3 font-normal">Verdict</th><th className="font-normal">What it found</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-1 pr-3">{r.who}</td>
              <td className={`py-1 pr-3 font-semibold ${r.ok ? "text-intact" : "text-tampered"}`}>{r.ok ? "✔ intact" : "✘ problem"}</td>
              <td className="py-1">{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notes.map((n) => (
        <p key={n} className="rounded-md bg-surface-2 p-2 text-sm">{n}</p>
      ))}
    </div>
  );
}
