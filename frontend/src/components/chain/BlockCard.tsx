import { forwardRef } from "react";
import { ACTION_META, VERIFICATION_META, type ApiRecord, type RecordCheck } from "@dpp/shared";
import { formatEth, shortHash } from "@/lib/format";

export const CARD_W = 208;
export const LINK_W = 64;

const BORDER: Record<RecordCheck["status"], string> = {
  intact: "border-intact",
  dataTampered: "border-tampered",
  linkBroken: "border-tampered",
  anchorMismatch: "border-anchor",
};

const ACTION_BAR: Record<number, string> = {
  0: "bg-registered", 1: "bg-listed", 2: "bg-delisted", 3: "bg-sold", 4: "bg-reserved", 5: "bg-revoked",
};

export interface BlockCardProps {
  record: ApiRecord;
  /** The browser's own verdict on this record. */
  check: RecordCheck | undefined;
  selected?: boolean;
  /** De-emphasised, e.g. when another product is being followed. */
  dimmed?: boolean;
  focusable?: boolean;
  onSelect?: () => void;
}

/**
 * One record of the ledger drawn as a block: what it is, whose product, and the two hashes that tie
 * it to its neighbours. Colour and an icon both show whether it passed verification.
 */
export const BlockCard = forwardRef<HTMLButtonElement, BlockCardProps & React.ButtonHTMLAttributes<HTMLButtonElement>>(function BlockCard(
  { record, check, selected = false, dimmed = false, focusable = true, onSelect, className = "", ...rest },
  ref,
) {
  const meta = ACTION_META[record.action as keyof typeof ACTION_META];
  const status = check?.status ?? "intact";
  const verdict = VERIFICATION_META[status];
  const price = BigInt(record.price);

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={focusable ? 0 : -1}
      aria-pressed={selected}
      aria-label={`Record ${record.index}: ${meta?.label ?? record.actionLabel}${record.productName ? `, ${record.productName}` : ""}. ${verdict.label}.`}
      onClick={onSelect}
      style={{ width: CARD_W }}
      className={`group relative flex h-36 shrink-0 flex-col overflow-hidden rounded-lg border-2 bg-surface text-left shadow-sm transition-opacity hover:shadow-md ${BORDER[status]} ${
        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
      } ${dimmed ? "opacity-35" : ""} ${className}`}
      {...rest}
    >
      <span aria-hidden className={`h-1 w-full ${ACTION_BAR[record.action] ?? "bg-neutral"}`} />
      <span className="flex items-center justify-between px-3 pt-1.5">
        <span className="font-mono text-sm font-semibold">#{record.index}</span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: `var(--action-${actionVar(record.action)})` }}>
          <span aria-hidden>{meta?.icon}</span>
          {meta?.label ?? record.actionLabel}
        </span>
      </span>

      <span className="truncate px-3 text-sm">
        {record.productName ?? `Product #${record.productId}`}
        <span className="text-muted"> #{record.productId}</span>
      </span>
      {price > 0n && <span className="px-3 text-xs text-muted">{formatEth(price)} ETH</span>}

      <span className="mt-auto grid grid-cols-[auto_1fr] gap-x-2 border-t border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] leading-tight">
        <span className="text-muted">prev</span>
        <span className={check && !check.linkOk ? "text-tampered" : ""}>{shortHash(record.prevHash)}</span>
        <span className="text-muted">hash</span>
        <span className={check && !check.dataOk ? "text-tampered" : check?.anchorOk === false ? "text-anchor" : ""}>{shortHash(record.hash)}</span>
      </span>

      {status !== "intact" && (
        <span
          className="absolute right-1.5 top-2.5 rounded-full border border-current bg-surface px-1.5 text-[10px] font-semibold"
          style={{ color: status === "anchorMismatch" ? "var(--status-anchor)" : "var(--status-data)" }}
        >
          <span aria-hidden>{verdict.icon} </span>
          {verdict.label}
        </span>
      )}
    </button>
  );
});

function actionVar(action: number): string {
  return ["registered", "listed", "delisted", "sold", "reserved", "revoked"][action] ?? "delisted";
}
