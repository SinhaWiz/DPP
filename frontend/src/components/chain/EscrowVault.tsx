import { useState } from "react";
import type { ApiProduct } from "@dpp/shared";
import { Address, Eth } from "@/components/common/Primitives";
import { formatDateTime } from "@/lib/format";
import { useActAs } from "@/lib/useActAs";
import { useRole } from "@/lib/roles";
import { getLiveController, useLive } from "@/store/live";
import { useWallet } from "@/store/wallet";

const DAY = 24 * 3600;

/** What the chain's clock says now: the newest block's time (the clock can be moved forward in the lab). */
function useChainTime(): number {
  const blocks = useLive((s) => s.blocks);
  return blocks.at(-1)?.timestamp ?? Math.floor(Date.now() / 1000);
}

function Party({ title, address }: { title: string; address: string }) {
  const role = useRole(address);
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-2 text-center">
      <p className="text-xs text-muted">{title}</p>
      <p className="font-medium">{role?.name ?? "Account"}</p>
      <Address value={address} copy={false} />
    </div>
  );
}

/**
 * A purchase held in escrow: the buyer's money sits in the contract between buyer and seller until the
 * seller confirms, someone backs out, or the deadline passes.
 */
export function EscrowVault({ product }: { product: ApiProduct }) {
  const r = product.reservation;
  const actAs = useActAs();
  const now = useChainTime();
  const lab = useLive((s) => s.session?.lab.available ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r) return null;

  const expired = BigInt(r.expiresAt) < BigInt(now);
  const id = BigInt(product.id);

  const perform = async (fn: "confirmSale" | "revokeReservation" | "rejectReservation" | "expireReservation", who: string) => {
    setBusy(true);
    setError(null);
    try {
      await actAs(who, fn, [id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fastForward = async () => {
    setBusy(true);
    setError(null);
    try {
      await getLiveController().api.lab.increaseTime(DAY + 1);
      await getLiveController().flush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Btn = ({ onClick, children, hint }: { onClick: () => void; children: React.ReactNode; hint: string }) => (
    <button type="button" title={hint} disabled={busy} onClick={onClick} className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-40">
      {children}
    </button>
  );

  return (
    <section aria-label="Escrow vault" className="rounded-xl border-2 border-reserved/60 bg-reserved/5 p-4">
      <h3 className="mb-2 font-semibold text-reserved">◐ In escrow: {product.name} #{product.id}</h3>

      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
        <Party title="Buyer" address={r.buyer} />
        <span aria-hidden className="text-muted">→</span>
        <div className="rounded-lg border-2 border-reserved p-2 text-center" aria-label="The vault">
          <p aria-hidden className="text-xl">🔒</p>
          <p className="text-sm font-semibold"><Eth wei={r.amount} /></p>
          <p className="text-xs text-muted">held by the contract</p>
        </div>
        <span aria-hidden className="text-muted">→</span>
        <Party title="Seller" address={product.owner} />
      </div>

      <p className="mt-2 text-sm" role="status">
        {expired ? (
          <span className="text-pending">The deadline passed on {formatDateTime(r.expiresAt)}. The seller can no longer confirm, and anyone can end the reservation so the buyer is refunded.</span>
        ) : (
          <>The seller has until <strong>{formatDateTime(r.expiresAt)}</strong> to confirm. The product is locked until then: nobody else can buy or re-list it.</>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!expired && <Btn onClick={() => void perform("confirmSale", product.owner)} hint="Seller accepts: ownership moves and the payment becomes withdrawable by the seller">Confirm sale (seller)</Btn>}
        <Btn onClick={() => void perform("revokeReservation", r.buyer)} hint="Buyer backs out: the deposit becomes refundable">Cancel (buyer)</Btn>
        <Btn onClick={() => void perform("rejectReservation", product.owner)} hint="Seller declines: the deposit becomes refundable to the buyer">Reject (seller)</Btn>
        {expired ? (
          <Btn onClick={() => void perform("expireReservation", connectedOr(r.buyer))} hint="Anyone can end an overdue reservation">Expire it (anyone)</Btn>
        ) : (
          lab && <Btn onClick={() => void fastForward()} hint="Move the chain's clock forward one day, so the deadline passes">Fast-forward one day</Btn>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-tampered">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        Whatever you choose, a record is added: <em>Sold</em> if confirmed, <em>Revoked</em> otherwise. The earlier <em>Reserved</em> record is never erased; a revocation is a new record that reverses it.
      </p>
    </section>
  );
}

/** Anyone may expire a reservation; use whoever is connected, falling back to the buyer's address. */
function connectedOr(fallback: string): string {
  return useWallet.getState().wallet?.address ?? fallback;
}
