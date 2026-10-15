import { useState } from "react";
import { getTxFlow } from "@/store/flowInstance";
import { getLiveController, useLive } from "@/store/live";
import { useUi } from "@/store/uiStore";
import { useWallet } from "@/store/wallet";
import { RuleError, runRule, type RuleEnv } from "@/web3/ruleRunner";
import { RULES, type Rule } from "@/web3/rules";
import { connectDemo, defaultRpcUrl } from "@/web3/wallet";

/** Everything a rule needs from the running app. */
export function useRuleEnv(): RuleEnv | null {
  const { market, count, mode, lab } = useLive((s) => ({
    market: s.session?.contracts?.market ?? null,
    count: s.session?.productCount ?? 0,
    mode: s.mining?.mode ?? null,
    lab: s.session?.lab.available ?? false,
  }));
  if (!market || !lab) return null;
  return {
    marketAddress: market,
    productCount: count,
    automine: mode === "auto",
    signerFor: (role) => connectDemo(defaultRpcUrl(), role),
    actAs: (role) => useWallet.getState().useDemo(role),
    increaseTime: (s) => getLiveController().api.lab.increaseTime(s),
    flow: getTxFlow(),
  };
}

/** One button per contract error: sets the scene with real transactions, then breaks the rule on the chain. */
export function BreakRules({ env: injected }: { env?: RuleEnv | null }) {
  const real = useRuleEnv();
  const env = injected === undefined ? real : injected;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "progress" | "done" | "error"; text: string } | null>(null);

  const run = async (rule: Rule) => {
    if (!env) return;
    setBusy(rule.error);
    setMessage({ kind: "progress", text: "Getting ready…" });
    try {
      await runRule(rule, { ...env, onProgress: (text) => setMessage({ kind: "progress", text: `${text}…` }) });
      useUi.getState().setDockTab("pipeline");
      setMessage({ kind: "done", text: `Sent. Watch the pipeline below: the contract refuses it with ${rule.error}, the transaction is mined and reverted, and nothing is recorded.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof RuleError || e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const runScenario = async () => {
    setBusy("scenario");
    setMessage({ kind: "progress", text: "Running every failing call…" });
    try {
      const r = await getLiveController().api.lab.runScenario("everyError");
      useUi.getState().setDockTab("activity");
      setMessage({ kind: "done", text: `Done: ${r.steps.length} steps. See every failure in the Activity tab and the Failed attempts tray.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Try to break the rules</summary>
      <div className="space-y-2 border-t border-border p-3">
        <p className="text-xs text-muted">
          Each button builds the situation with real transactions and then sends a call the contract must refuse, so you can watch exactly how.
          It creates a small demo product each time.
        </p>
        {!env && <p className="text-xs text-pending">Available on the local development chain once a contract is deployed.</p>}
        {env && !env.automine && <p className="text-xs text-pending">Switch mining to Auto first: setting things up waits for each transaction.</p>}

        <ul className="space-y-1.5">
          {RULES.map((rule) => (
            <li key={rule.error} className="rounded-md border border-border p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{rule.title}</p>
                  <p className="text-xs text-muted">{rule.teaches}</p>
                  <code className="text-[11px] text-tampered">{rule.error}</code>
                </div>
                {!rule.scenarioOnly && (
                  <button
                    type="button"
                    disabled={!env || !env.automine || busy !== null}
                    onClick={() => void run(rule)}
                    aria-label={`Try it: ${rule.title}`}
                    className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
                  >
                    Try it
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-md bg-surface-2 p-2 text-xs">
          Two rules need the “Broken Wallet”, a contract that refuses ETH ({RULES.filter((r) => r.scenarioOnly).map((r) => r.error).join(", ")}).
          <button
            type="button"
            disabled={!env || !env.automine || busy !== null}
            onClick={() => void runScenario()}
            className="ml-2 rounded-md border border-border px-2.5 py-1 hover:bg-surface disabled:opacity-40"
          >
            Run the “Every error” scenario
          </button>
        </div>

        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} aria-label="Rule result" className={`text-sm ${message.kind === "error" ? "text-tampered" : message.kind === "done" ? "text-intact" : "text-muted"}`}>
            {message.text}
          </p>
        )}
      </div>
    </details>
  );
}
