import type { Api } from "@/api/client";
import type { TxFlow } from "@/store/txFlow";
import { actionByFn } from "./actions";
import { MarketClient } from "./market";
import type { Rule, Step } from "./rules";
import type { Wallet } from "./wallet";

export interface RuleEnv {
  marketAddress: string;
  /** Number of products registered so far; the demo product will get the next id. */
  productCount: number;
  /** Chain must mine by itself: setup steps wait for their receipts. */
  automine: boolean;
  /** A signer for a built-in account (demo mode). */
  signerFor(role: number): Promise<Wallet>;
  /** Switch the UI to act as this role. */
  actAs(role: number): Promise<void>;
  increaseTime(seconds: number): Promise<unknown>;
  flow: TxFlow;
  onProgress?(message: string): void;
}

export class RuleError extends Error {}

async function runStep(env: RuleEnv, step: Step): Promise<void> {
  env.onProgress?.(step.label);
  const wallet = await env.signerFor(step.role);
  const client = new MarketClient(env.marketAddress, wallet.signer);
  const sent = await client.send(step.fn, step.args, { value: step.value });
  await sent.response.wait();
}

/**
 * Builds the situation a rule needs with real transactions, then fires the failing call "anyway", so
 * the learner watches the contract refuse it on the chain. Returns the id of the transaction it sent.
 */
export async function runRule(rule: Rule, env: RuleEnv): Promise<{ txId: string }> {
  if (rule.scenarioOnly) throw new RuleError("This one needs the Broken Wallet contract. Use “Run the Every error scenario”.");
  if (!env.automine) throw new RuleError("Switch mining back to Auto first: setting things up waits for each transaction to be mined.");

  const plan = rule.plan(BigInt(env.productCount) + 1n);
  try {
    for (const step of plan.setup) await runStep(env, step);
    if (plan.advanceSeconds) {
      env.onProgress?.(`Moving the chain's clock forward ${Math.round(plan.advanceSeconds / 3600)} hours`);
      await env.increaseTime(plan.advanceSeconds);
    }
  } catch (e) {
    throw new RuleError(`Could not set the situation up: ${e instanceof Error ? e.message : e}`);
  }

  env.onProgress?.(plan.act.label);
  await env.actAs(plan.act.role);
  const def = actionByFn(plan.act.fn);
  const flow = env.flow;
  const tx = flow.draft(def, { args: plan.act.args, value: plan.act.value });
  await flow.simulate(tx.id);            // shows the explanation of why it will fail
  await flow.submit(tx.id, { force: true });   // and sends it anyway, to watch it revert
  return { txId: tx.id };
}

export type { Api };
