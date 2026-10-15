/** A placeholder shaped like a row of blocks, shown while the chain loads. Announced to screen readers as the text. */
export function ChainSkeleton({ label = "Loading the chain…" }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-36 w-40 shrink-0 animate-pulse rounded-lg border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
