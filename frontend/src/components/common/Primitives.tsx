import { ACTION_META, LIFECYCLE_META, VERIFICATION_META, type Action, type TxLifecycleState, type VerificationStatus } from "@dpp/shared";
import { formatEth, groupedWord, group, shortAddress, shortHash } from "@/lib/format";
import { useRole } from "@/lib/roles";
import { CopyButton } from "./CopyButton";
import { Tooltip } from "./Tooltip";

const mono = "font-mono text-[0.85em]";

/** A hash, shortened. The full value is one hover, focus or click away. */
export function Hash({ value, label, copy = true }: { value: string; label?: string; copy?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip
        interactive
        content={
          <div>
            {label && <div className="mb-1 text-xs font-medium text-muted">{label}</div>}
            <code className={`${mono} break-all`}>{value}</code>
          </div>
        }
      >
        <span tabIndex={0} className={`${mono} cursor-help rounded`} aria-label={`${label ?? "Hash"} ${value}`}>
          {shortHash(value)}
        </span>
      </Tooltip>
      {copy && <CopyButton value={value} label={`Copy ${label?.toLowerCase() ?? "hash"}`} />}
    </span>
  );
}

/** An account: its role name when it has one, always with the shortened address. */
export function Address({ value, copy = true }: { value: string; copy?: boolean }) {
  const role = useRole(value);
  const zero = /^0x0+$/.test(value);
  if (zero) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip
        interactive
        content={
          <div>
            {role && <div className="font-medium">{role.name}</div>}
            {role?.description && <div className="mb-1 text-xs text-muted">{role.description}</div>}
            <code className={`${mono} break-all`}>{value}</code>
          </div>
        }
      >
        <span tabIndex={0} className="cursor-help rounded" aria-label={`${role ? role.name + " " : ""}${value}`}>
          {role ? (
            <>
              <span className="font-medium">{role.name}</span> <span className={`${mono} text-muted`}>{shortAddress(value)}</span>
            </>
          ) : (
            <span className={mono}>{shortAddress(value)}</span>
          )}
        </span>
      </Tooltip>
      {copy && <CopyButton value={value} label="Copy address" />}
    </span>
  );
}

/** An amount in ETH; the exact wei is in the tooltip. */
export function Eth({ wei }: { wei: bigint | string }) {
  const value = typeof wei === "bigint" ? wei : BigInt(wei);
  return (
    <Tooltip content={<span className={mono}>{group(value)} wei</span>}>
      <span tabIndex={0} className="cursor-help whitespace-nowrap rounded" aria-label={`${formatEth(value)} ETH, ${group(value)} wei`}>
        {formatEth(value)} <span className="text-muted">ETH</span>
      </span>
    </Tooltip>
  );
}

const ACTION_TEXT: Record<Action, string> = {
  0: "text-registered border-registered",
  1: "text-listed border-listed",
  2: "text-delisted border-delisted",
  3: "text-sold border-sold",
  4: "text-reserved border-reserved",
  5: "text-revoked border-revoked",
};

/** The kind of ledger record, as colour + icon + label (never colour alone). */
export function ActionBadge({ action, compact = false }: { action: Action; compact?: boolean }) {
  const meta = ACTION_META[action];
  if (!meta) return <span className="text-muted">Unknown({String(action)})</span>;
  return (
    <Tooltip content={<span>{meta.summary}</span>}>
      <span tabIndex={0} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_TEXT[action]}`}>
        <span aria-hidden>{meta.icon}</span>
        {compact ? <span className="sr-only">{meta.label}</span> : <span>{meta.label}</span>}
      </span>
    </Tooltip>
  );
}

const STATUS_TEXT: Record<VerificationStatus, string> = {
  intact: "text-intact border-intact",
  dataTampered: "text-tampered border-tampered",
  linkBroken: "text-tampered border-tampered border-dashed",
  anchorMismatch: "text-anchor border-anchor",
};

/** Whether a record passed verification, and if not, which way it failed. */
export function StatusPill({ status }: { status: VerificationStatus }) {
  const meta = VERIFICATION_META[status];
  return (
    <Tooltip content={<span>{meta.summary}</span>}>
      <span tabIndex={0} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TEXT[status]}`}>
        <span aria-hidden>{meta.icon}</span>
        <span>{meta.label}</span>
      </span>
    </Tooltip>
  );
}

const LIFECYCLE_TEXT: Record<TxLifecycleState, string> = {
  pending: "text-pending border-pending pulse-ring",
  mined: "text-sold border-sold",
  recorded: "text-intact border-intact",
  verified: "text-intact border-intact",
  failed: "text-tampered border-tampered",
  replaced: "text-neutral border-neutral line-through",
  dropped: "text-neutral border-neutral border-dashed line-through",
};

/** Where a transaction is in its life. */
export function LifecyclePill({ state }: { state: TxLifecycleState }) {
  const meta = LIFECYCLE_META[state];
  return (
    <Tooltip content={<span>{meta.summary}</span>}>
      <span tabIndex={0} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${LIFECYCLE_TEXT[state]}`}>
        <span aria-hidden>{meta.icon}</span>
        <span>{meta.label}</span>
      </span>
    </Tooltip>
  );
}

/** A raw 32-byte storage word, in groups of 8 hex digits with long runs of zeros dimmed. */
export function SlotValue({ value }: { value: string }) {
  return (
    <code className={`${mono} inline-flex flex-wrap gap-x-1.5`} aria-label={`slot value ${value}`}>
      {groupedWord(value).map((g, i) => (
        <span key={i} className={/^0+$/.test(g) ? "text-muted opacity-60" : ""}>{g}</span>
      ))}
    </code>
  );
}
