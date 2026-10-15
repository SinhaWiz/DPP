import { useState } from "react";
import type { ApiProduct } from "@dpp/shared";

export interface ChainControlsProps {
  recordCount: number;
  products: ApiProduct[];
  productFilter: string | null;
  compact: boolean;
  showBlocks: boolean;
  onJump(index: number): void;
  onProductFilter(id: string | null): void;
  onCompact(v: boolean): void;
  onShowBlocks(v: boolean): void;
}

/** Find a record, follow one product, zoom out, and show the Ethereum blocks underneath. */
export function ChainControls(p: ChainControlsProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === "" || !Number.isInteger(n) || n < 0 || n >= p.recordCount) {
      setError(p.recordCount === 0 ? "The ledger is empty." : `Enter a record number from 0 to ${p.recordCount - 1}.`);
      return;
    }
    setError(null);
    p.onJump(n);
  };

  return (
    <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
      <form onSubmit={go} className="flex items-end gap-1.5">
        <label className="flex flex-col">
          <span className="text-xs text-muted">Jump to record #</span>
          <input
            inputMode="numeric"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            aria-invalid={error !== null}
            aria-describedby={error ? "jump-error" : undefined}
            className="w-24 rounded-md border border-border bg-surface px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2">Go</button>
        {error && <span id="jump-error" role="alert" className="pb-1 text-tampered">{error}</span>}
      </form>

      <label className="flex flex-col">
        <span className="text-xs text-muted">Follow product</span>
        <select
          value={p.productFilter ?? ""}
          onChange={(e) => p.onProductFilter(e.target.value || null)}
          className="rounded-md border border-border bg-surface px-2 py-1"
        >
          <option value="">All products</option>
          {p.products.map((pr) => (
            <option key={pr.id} value={pr.id}>#{pr.id} {pr.name}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={p.compact} onChange={(e) => p.onCompact(e.target.checked)} />
        Compact
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={p.showBlocks} onChange={(e) => p.onShowBlocks(e.target.checked)} />
        Show Ethereum blocks
      </label>
    </div>
  );
}
