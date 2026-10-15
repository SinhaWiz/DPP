import type { Link } from "@/store/live";
import { useLive } from "@/store/live";
import { useRoles } from "@/lib/roles";
import { useWallet } from "@/store/wallet";
import { Address } from "@/components/common/Primitives";

const LINK: Record<Link, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-intact" },
  connecting: { label: "Connecting…", dot: "bg-pending pulse-ring" },
  offline: { label: "Offline", dot: "bg-tampered" },
};

/** Backend connection, chain and block height in one glance. */
export function LinkStatus() {
  const link = useLive((s) => s.link);
  const session = useLive((s) => s.session);
  const { label, dot } = LINK[link];
  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-label={`Backend ${label}`}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span>{label}</span>
      </span>
      {session?.chainId != null && (
        <span className="text-muted">
          chain {session.chainId}
          {session.headBlock != null && <> · block <span className="font-mono">{session.headBlock}</span></>}
        </span>
      )}
    </div>
  );
}

/** Choose who you act as: one of the built-in accounts (a role), or your own MetaMask. */
export function AccountSwitcher() {
  const roles = useRoles().filter((r) => r.index >= 0);
  const chainId = useLive((s) => s.session?.chainId ?? 31337);
  const { mode, demoIndex, wallet, busy, error, useDemo, useMetaMask } = useWallet();

  const value = mode === "metamask" ? "metamask" : demoIndex !== null ? String(demoIndex) : "";
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted">Act as</span>
        <select
          aria-label="Act as"
          value={value}
          disabled={busy}
          onChange={(e) => (e.target.value === "metamask" ? void useMetaMask(chainId) : void useDemo(Number(e.target.value)))}
          className="rounded-md border border-border bg-surface px-2 py-1"
        >
          {value === "" && <option value="" disabled>Choose…</option>}
          {roles.map((r) => (
            <option key={r.index} value={r.index}>{r.name}</option>
          ))}
          <option value="metamask">MetaMask (my wallet)</option>
        </select>
      </label>
      {wallet && <span className="hidden md:inline"><Address value={wallet.address} /></span>}
      {error && <span role="alert" className="max-w-xs truncate text-sm text-tampered" title={error}>{error}</span>}
    </div>
  );
}
