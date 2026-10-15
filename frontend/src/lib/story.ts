import { parseEther } from "ethers";
import type { RuleEnv } from "@/web3/ruleRunner";
import { actionByFn } from "@/web3/actions";
import { ROLE } from "@/web3/rules";
import { FINAL_STAGES } from "@/store/flowTypes";
import type { MarketFunction } from "@/web3/market";

export interface StoryStep {
  role: number;
  roleName: string;
  fn: MarketFunction;
  /** Arguments for the call, given the id of the product the story creates. */
  args: (productId: bigint) => unknown[];
  value?: bigint;
  /** What is happening and why it matters, in plain English with [[glossary]] markers. */
  caption: string;
}

const ETH = (v: string) => parseEther(v);

/** The life of one laptop from manufacturer to customer, using both ways of selling. */
export const STORY: StoryStep[] = [
  { role: ROLE.Manufacturer, roleName: "Manufacturer", fn: "registerProduct", args: () => ["Story laptop"], caption: "The Manufacturer registers a laptop. The contract appends the first [[record]] for it and the Manufacturer becomes its owner." },
  { role: ROLE.Manufacturer, roleName: "Manufacturer", fn: "listForSale", args: (id) => [id, ETH("1")], caption: "The Manufacturer puts it up for sale at 1 ETH. Listing creates a new record; it does not change who owns it." },
  { role: ROLE.Distributor, roleName: "Distributor", fn: "buy", args: (id) => [id], value: ETH("1"), caption: "The Distributor buys it with an instant sale. The payment is pushed straight to the seller, ownership changes, and a **Sold** record is appended." },
  { role: ROLE.Distributor, roleName: "Distributor", fn: "listForSale", args: (id) => [id, ETH("1.5")], caption: "The new owner lists it again, at 1.5 ETH. Every step so far is a block linked to the one before." },
  { role: ROLE.Retailer, roleName: "Retailer", fn: "reserve", args: (id) => [id], value: ETH("1.5"), caption: "The Retailer reserves it instead of buying outright. The 1.5 ETH goes into [[escrow]] and the product is locked until the seller decides." },
  { role: ROLE.Distributor, roleName: "Distributor", fn: "confirmSale", args: (id) => [id], caption: "The Distributor confirms. Ownership moves to the Retailer, and the payment is credited to the Distributor to withdraw: a [[pullpayment|pull payment]]." },
  { role: ROLE.Distributor, roleName: "Distributor", fn: "withdraw", args: () => [], caption: "The Distributor collects the money. Withdrawing moves ETH but changes no product, so it adds no ledger record." },
  { role: ROLE.Retailer, roleName: "Retailer", fn: "listForSale", args: (id) => [id, ETH("2")], caption: "The Retailer lists it at 2 ETH." },
  { role: ROLE.Customer, roleName: "Customer", fn: "buy", args: (id) => [id], value: ETH("2"), caption: "The Customer buys it. The laptop has now passed through four owners, and every hand-over is in the chain. Open the Explorer and follow this product to read its whole story." },
];

export interface StoryEnv extends Pick<RuleEnv, "productCount" | "automine" | "actAs" | "flow"> {
  /** Pause between steps; replaced in tests. */
  sleep(ms: number): Promise<void>;
  /** Reports the step that is about to run. */
  onStep(index: number, step: StoryStep): void;
  signal?: AbortSignal;
  pauseMs?: number;
  /** How long to wait for one transaction to reach a final state. */
  stepTimeoutMs?: number;
}

export class StoryError extends Error {}

const wait = async (env: StoryEnv, ms: number) => {
  if (ms > 0) await env.sleep(ms);
  if (env.signal?.aborted) throw new StoryError("Stopped.");
};

/** Plays the story through the real transaction flow. Resolves with the product id, or throws if it was stopped or a step failed. */
export async function playStory(env: StoryEnv, steps: StoryStep[] = STORY): Promise<{ productId: bigint }> {
  if (!env.automine) throw new StoryError("Switch mining back to Auto first: each step waits for its transaction to be mined.");
  const productId = BigInt(env.productCount) + 1n;

  for (const [i, step] of steps.entries()) {
    if (env.signal?.aborted) throw new StoryError("Stopped.");
    env.onStep(i, step);
    await env.actAs(step.role);

    const tx = env.flow.draft(actionByFn(step.fn), { args: step.args(productId), value: step.value });
    await env.flow.run(tx.id);

    const deadline = Date.now() + (env.stepTimeoutMs ?? 20_000);
    while (!FINAL_STAGES.includes(env.flow.get(tx.id)!.stage)) {
      if (Date.now() > deadline) throw new StoryError(`${step.roleName}'s ${step.fn} did not finish in time.`);
      await wait(env, 100);
    }
    const final = env.flow.get(tx.id)!;
    if (final.stage !== "mined") {
      throw new StoryError(`${step.roleName}'s ${step.fn} did not succeed (${final.error?.title ?? final.stage}). The story stops here.`);
    }
    await wait(env, env.pauseMs ?? 2200);
  }
  return { productId };
}
