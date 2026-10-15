import type { ApiProductTrail } from "@dpp/shared";
import { ActionBadge, Address, Eth, StatusPill } from "@/components/common/Primitives";
import { useRole } from "@/lib/roles";

/** A coloured circle with initials, stable per account, so ownership changes are easy to follow. */
function Avatar({ address }: { address: string }) {
  const role = useRole(address);
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const label = role?.name ?? address.slice(0, 6);
  const initials = role ? role.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : address.slice(2, 4).toUpperCase();
  return (
    <span
      aria-hidden
      title={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: `hsl(${hue} 55% 38%)` }}
    >
      {initials}
    </span>
  );
}

/**
 * Whether a listing's price was later taken back: the next step withdrew the listing (Delisted) or
 * replaced it with another price (Listed again). Such prices are drawn struck through.
 */
export function isWithdrawnListing(steps: ApiProductTrail["steps"], i: number): boolean {
  if (steps[i]!.record.action !== 1) return false;
  const next = steps[i + 1]?.record.action;
  return next === 2 || next === 1;
}

export interface ProductTimelineProps {
  trail: ApiProductTrail;
  selected: bigint | null;
  onSelect(index: bigint): void;
}

export function ProductTimeline({ trail, selected, onSelect }: ProductTimelineProps) {
  const { product, steps } = trail;
  return (
    <section aria-label={`Timeline of ${product.name}`} className="rounded-xl border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{product.name} <span className="text-muted">#{product.id}</span></h2>
        <span className="text-sm text-muted">owned by</span>
        <Address value={product.owner} />
        {product.reservation && <span className="rounded-full border border-reserved px-2 py-0.5 text-xs text-reserved">◐ reserved</span>}
      </header>

      <ol className="relative ml-3 border-l-2 border-border">
        {steps.map((step, i) => {
          const { record } = step;
          const prevOwner = steps[i - 1]?.ownerAfter;
          const ownerChanged = prevOwner !== undefined && prevOwner.toLowerCase() !== step.ownerAfter.toLowerCase();
          const withdrawn = isWithdrawnListing(steps, i);
          const isSelected = selected !== null && selected === BigInt(record.index);
          return (
            <li key={record.index} className="relative pb-4 pl-6 last:pb-0">
              <span aria-hidden className="absolute -left-[7px] top-2 h-3 w-3 rounded-full border-2 border-border bg-surface" />
              <button
                type="button"
                onClick={() => onSelect(BigInt(record.index))}
                aria-pressed={isSelected}
                className={`w-full rounded-lg border p-2 text-left hover:bg-surface-2 ${isSelected ? "border-accent bg-surface-2" : "border-transparent"}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">#{record.index}</span>
                  <ActionBadge action={record.action as 0} />
                  {BigInt(record.price) > 0n && (
                    <span className={withdrawn ? "line-through opacity-60" : ""} aria-label={withdrawn ? "price (withdrawn)" : "price"}>
                      <Eth wei={record.price} />
                    </span>
                  )}
                  {record.check.status !== "intact" && <StatusPill status={record.check.status} />}
                </span>
                <span className="mt-1 block text-sm">{step.note}</span>
                <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <Avatar address={step.ownerAfter} />
                  <span>owner after this step{ownerChanged ? ": changed" : ""}</span>
                  {ownerChanged && <span className="font-medium text-sold">→ <Address value={step.ownerAfter} copy={false} /></span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
