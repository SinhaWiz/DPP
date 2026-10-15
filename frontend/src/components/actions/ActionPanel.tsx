import { useMemo, useState } from "react";
import { Address } from "@/components/common/Primitives";
import { formatEth } from "@/lib/format";
import { useRole } from "@/lib/roles";
import { getTxFlow, useFlow } from "@/store/flowInstance";
import { useLive } from "@/store/live";
import { useUi } from "@/store/uiStore";
import { useWallet } from "@/store/wallet";
import { ACTIONS, actionByFn, buildCall, predict, type ActionDef, type FormValues } from "@/web3/actions";
import type { MarketFunction } from "@/web3/market";

const LEVEL_STYLE = { ok: "text-intact", warn: "text-pending", unknown: "text-muted" } as const;
const LEVEL_ICON = { ok: "✔", warn: "!", unknown: "·" } as const;

/** Who is acting, what they want to do, and a prediction of what the contract will say. */
export function ActionPanel() {
  const products = useLive((s) => s.products);
  const wallet = useWallet((s) => s.wallet);
  const me = wallet?.address ?? null;
  const role = useRole(me);

  const [fn, setFn] = useState<MarketFunction>("registerProduct");
  const [form, setForm] = useState<FormValues>({});
  const def = actionByFn(fn);

  const { built, inputError } = useMemo(() => {
    try {
      return { built: buildCall(def, form, products), inputError: null as string | null };
    } catch (e) {
      return { built: null, inputError: e instanceof Error ? e.message : String(e) };
    }
  }, [def, form, products]);
  const prediction = useMemo(() => predict(def, built, products, me), [def, built, products, me]);

  const set = (name: string, value: string) => setForm((f) => ({ ...f, [name]: value }));
  const choose = (next: MarketFunction) => {
    setFn(next);
    setForm((f) => ({ productId: f.productId ?? "" }));
  };

  const prepare = () => {
    if (!built) return null;
    const tx = getTxFlow().draft(def, built);
    useUi.getState().setDockTab("pipeline");
    return tx;
  };
  const send = async () => {
    const tx = prepare();
    if (tx) await getTxFlow().run(tx.id);
  };
  const simulateOnly = async () => {
    const tx = prepare();
    if (tx) await getTxFlow().simulate(tx.id);
  };

  const product = products.find((p) => p.id === form.productId);
  const ready = me !== null && built !== null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-2 p-3 text-sm">
        {wallet ? (
          <p>
            Acting as <strong>{role?.name ?? "your account"}</strong> <Address value={wallet.address} copy={false} />
          </p>
        ) : (
          <p className="text-muted">Choose who you act as in the bar above (a role, or your own MetaMask).</p>
        )}
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">What do you want to do?</legend>
        <div role="radiogroup" aria-label="Action" className="grid grid-cols-1 gap-1">
          {ACTIONS.map((a) => (
            <label key={a.fn} className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-sm ${a.fn === fn ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2"}`}>
              <input type="radio" name="action" value={a.fn} checked={a.fn === fn} onChange={() => choose(a.fn)} className="sr-only" />
              <span className="font-medium">{a.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-muted">{def.summary}</p>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {def.params.map((p) => (
          <label key={p.name} className="block text-sm">
            <span className="mb-0.5 block text-xs text-muted">{p.label}</span>
            {p.kind === "product" ? (
              <select value={form[p.name] ?? ""} onChange={(e) => set(p.name, e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5">
                <option value="">Choose a product…</option>
                {products.map((pr) => (
                  <option key={pr.id} value={pr.id}>#{pr.id} {pr.name}{pr.forSale ? ` · ${formatEth(pr.price)} ETH` : ""}{pr.reservation ? " · reserved" : ""}</option>
                ))}
              </select>
            ) : (
              <input
                value={form[p.name] ?? ""}
                onChange={(e) => set(p.name, e.target.value)}
                placeholder={p.placeholder}
                inputMode={p.kind === "eth" ? "decimal" : undefined}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
              />
            )}
          </label>
        ))}

        {def.payable && (
          <label className="block text-sm">
            <span className="mb-0.5 block text-xs text-muted">Payment (ETH)</span>
            <input
              value={form.value ?? ""}
              onChange={(e) => set("value", e.target.value)}
              placeholder={product && product.forSale ? formatEth(product.price) : "the listed price"}
              inputMode="decimal"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
            />
            <span className="mt-0.5 block text-xs text-muted">Left empty, the listed price is sent. Type a different amount to see what happens.</span>
          </label>
        )}

        <p aria-live="polite" className={`text-sm ${LEVEL_STYLE[inputError && def.params.length > 0 && !form.productId && def.params.some((x) => x.kind === "product") ? "unknown" : prediction.level]}`}>
          <span aria-hidden>{LEVEL_ICON[prediction.level]} </span>
          {inputError && prediction.level === "unknown" ? inputError : prediction.message}
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!ready} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Send
          </button>
          <button type="button" disabled={!ready} onClick={() => void simulateOnly()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40">
            Just simulate
          </button>
        </div>
      </form>

      <ActiveTxControls def={def} />
    </div>
  );
}

/** What to do next with the most recent transaction, when it is waiting on you. */
function ActiveTxControls({ def }: { def: ActionDef }) {
  const active = useFlow((s) => s.items.find((t) => t.id === s.activeId) ?? null);
  const flow = getTxFlow();
  if (!active) return null;

  if (active.stage === "simulated") {
    return (
      <div className="rounded-lg border border-intact p-3 text-sm" role="status">
        <p className="mb-2 font-medium">✔ The simulation says this would succeed.</p>
        <button type="button" onClick={() => void flow.submit(active.id)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white">Send it now</button>
      </div>
    );
  }
  if (active.stage === "simfail" && active.simulation && !active.simulation.ok) {
    const e = active.simulation.error;
    return (
      <div className="rounded-lg border border-tampered p-3 text-sm" role="alert">
        <p className="font-medium text-tampered">✘ This would fail: {e.title}</p>
        <p className="mt-1">{e.explanation}</p>
        <p className="mt-1 text-muted">{e.fix}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.remove(active.id)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">Fix it</button>
          <button type="button" onClick={() => void flow.sendAnyway(active.id)} className="rounded-md border border-tampered px-3 py-1.5 text-tampered hover:bg-surface-2">
            Send anyway
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">“Send anyway” puts the failing call on the chain so you can watch it revert. You pay gas, and nothing is recorded.</p>
        <span className="sr-only">{def.label}</span>
      </div>
    );
  }
  if (active.stage === "rejected" || active.stage === "error") {
    return (
      <div className="rounded-lg border border-pending p-3 text-sm" role="alert">
        <p className="font-medium">{active.error?.title ?? "It could not be sent"}</p>
        <p className="mt-1">{active.error?.explanation}</p>
        <p className="mt-1 text-muted">{active.error?.fix}</p>
      </div>
    );
  }
  return null;
}
