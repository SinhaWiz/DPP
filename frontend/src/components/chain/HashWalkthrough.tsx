import { useState } from "react";
import { explainHash, type ApiRecord } from "@dpp/shared";
import { apiToLedgerRecord } from "@/lib/verifyInBrowser";
import { Hash } from "@/components/common/Primitives";

const STEPS = [
  { title: "1. The fields", text: "Every field of the record is a number or an address. These eight values, and nothing else, go into the hash." },
  { title: "2. Each field becomes 32 bytes", text: "The EVM stores everything in 32-byte words, so each value is padded to exactly that size (ABI encoding)." },
  { title: "3. Join the words", text: "The eight words are placed one after another: 8 × 32 = 256 bytes. This is the exact input of the hash function." },
  { title: "4. keccak256", text: "The hash function turns those 256 bytes into one 32-byte fingerprint. Change a single bit anywhere and the fingerprint changes completely." },
  { title: "5. Compare", text: "If the result equals the hash stored in the record, the record is exactly what was written. prevHash is one of the eight inputs: that is what makes records a chain." },
] as const;

/** A step-by-step walk through how a record's hash is computed, using the same recipe as the contract. */
export function HashWalkthrough({ record }: { record: ApiRecord }) {
  const [step, setStep] = useState(0);
  const explained = explainHash(apiToLedgerRecord(record));
  const current = STEPS[step]!;
  const matches = explained.hash.toLowerCase() === record.hash.toLowerCase();

  return (
    <section aria-label="How is this hash made?" className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">How is this hash made?</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-md border border-border px-2 py-0.5 text-sm disabled:opacity-40"
          >
            Back
          </button>
          <span className="px-1 text-xs text-muted">Step {step + 1} of {STEPS.length}</span>
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={step === STEPS.length - 1}
            className="rounded-md border border-border px-2 py-0.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div aria-live="polite">
        <p className="font-medium">{current.title}</p>
        <p className="mb-2 text-sm text-muted">{current.text}</p>
      </div>

      {step <= 1 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="pr-2 font-normal">Field</th>
              <th className="pr-2 font-normal">Value</th>
              {step === 1 && <th className="font-normal">32-byte word</th>}
            </tr>
          </thead>
          <tbody>
            {explained.fields.map((f) => (
              <tr key={f.name} className="border-t border-border align-top">
                <td className="py-0.5 pr-2 font-mono text-xs">{f.name}<span className="text-muted"> {f.solidityType}</span></td>
                <td className="py-0.5 pr-2 break-all font-mono text-xs">{f.value}</td>
                {step === 1 && <td className="py-0.5 break-all font-mono text-[11px]">{f.word.slice(2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {step === 2 && (
        <div className="font-mono text-[11px] leading-tight" aria-label="Concatenated encoding">
          {explained.fields.map((f, i) => (
            <div key={f.name} className="flex gap-2">
              <span className="w-24 shrink-0 text-muted">{i * 32}–{i * 32 + 31}</span>
              <span className="break-all">{f.word.slice(2)}</span>
            </div>
          ))}
        </div>
      )}

      {step >= 3 && (
        <div className="space-y-1 text-sm">
          <p>keccak256(256 bytes) = <Hash value={explained.hash} label="Computed hash" /></p>
          {step === 4 && (
            <>
              <p>Stored in the record = <Hash value={record.hash} label="Stored hash" /></p>
              <p role="status" aria-label="Hash comparison" className={`font-medium ${matches ? "text-intact" : "text-tampered"}`}>
                {matches ? "✔ They match: the record's data is exactly what was hashed." : "✘ They differ: the record's data was changed after its hash was made."}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
