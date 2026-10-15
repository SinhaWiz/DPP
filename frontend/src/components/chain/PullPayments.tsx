import { useState } from "react";
import { Eth } from "@/components/common/Primitives";
import { useActAs } from "@/lib/useActAs";
import { useLive } from "@/store/live";

/**
 * Money that is owed but not yet paid out. In the escrow flow nobody is paid automatically: sale
 * proceeds and refunds are credited, and each account pulls its own with withdraw().
 */
export function PullPayments() {
  const balances = useLive((s) => s.balances);
  const actAs = useActAs();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owed = (balances?.balances ?? []).filter((b) => BigInt(b.withdrawable) > 0n);
  if (!balances || owed.length === 0) return null;

  const withdraw = async (address: string) => {
    setBusy(address);
    setError(null);
    try {
      await actAs(address, "withdraw");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Pull payments" className="rounded-xl border border-border p-4">
      <h3 className="font-semibold">Money waiting to be withdrawn</h3>
      <p className="mb-2 text-sm text-muted">
        After a confirmed sale or a revoked reservation the money is <em>credited</em>, not sent. Each account pulls its own with <code>withdraw()</code>, so one account that cannot receive ETH never blocks anyone else.
      </p>
      <ul className="space-y-1.5">
        {owed.map((b) => {
          const broken = b.name === "Broken Wallet";
          return (
            <li key={b.address} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-sm">
              <span className="font-medium">{b.name ?? "Account"}</span>
              <span className="text-muted">is owed</span>
              <Eth wei={b.withdrawable} />
              {broken ? (
                <span className="text-xs text-pending">
                  It refuses ETH, so its withdrawal fails (WithdrawFailed) and the money stays safe in the contract. The escrow itself worked; only this account is stuck.
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void withdraw(b.address)}
                  className="ml-auto rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  Withdraw as {b.name ?? "this account"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">The contract currently holds <Eth wei={balances.contractBalance} />: open reservations plus everything not yet withdrawn.</p>
      {error && <p role="alert" className="mt-1 text-sm text-tampered">{error}</p>}
    </section>
  );
}
