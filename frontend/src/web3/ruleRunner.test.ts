import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { customErrorNames } from "@dpp/shared";
import { startDevNode, deployContracts, type DevNode, type Deployed } from "@dpp/shared/testing";
import { TxFlow } from "@/store/txFlow";
import { configureWallet, useWallet } from "@/store/wallet";
import { MarketClient } from "./market";
import { RULES, ROLE } from "./rules";
import { RuleError, runRule, type RuleEnv } from "./ruleRunner";
import { connectDemo } from "./wallet";

describe("rule definitions", () => {
  it("cover every custom error a transaction can raise, exactly once", () => {
    const reachable = customErrorNames.filter((n) => !["RecordNotFound", "InvalidRange"].includes(n));
    expect(RULES.map((r) => r.error).sort()).toEqual([...reachable].sort());
    expect(new Set(RULES.map((r) => r.title)).size).toBe(RULES.length);
  });

  it("explain what each one teaches", () => {
    for (const r of RULES) {
      expect(r.title.length, r.error).toBeGreaterThan(8);
      expect(r.teaches.length, r.error).toBeGreaterThan(20);
    }
  });

  it("need the Broken Wallet only for the two errors that involve a contract that refuses ETH", () => {
    expect(RULES.filter((r) => r.scenarioOnly).map((r) => r.error)).toEqual(["PaymentFailed", "WithdrawFailed"]);
  });

  it("plan setup steps only from the built-in roles", () => {
    for (const r of RULES.filter((x) => !x.scenarioOnly)) {
      const plan = r.plan(5n);
      for (const s of [...plan.setup, plan.act]) expect(Object.values(ROLE)).toContain(s.role);
    }
  });
});

describe("every rule really triggers its error on a real contract", () => {
  let node: DevNode;
  let deployed: Deployed;
  let address: string;
  let flow: TxFlow;
  let advanced: number[] = [];

  const env = async (over: Partial<RuleEnv> = {}): Promise<RuleEnv> => ({
    marketAddress: address,
    productCount: Number(await deployed.market.getFunction("productCount")()),
    automine: true,
    signerFor: (role) => connectDemo(node.url, role),
    actAs: (role) => useWallet.getState().useDemo(role),
    increaseTime: async (s) => { advanced.push(s); await node.provider.send("evm_increaseTime", [s]); await node.provider.send("evm_mine", []); },
    flow,
    ...over,
  });

  beforeAll(async () => {
    node = await startDevNode();
    deployed = await deployContracts(node.provider);
    address = await deployed.market.getAddress();
    configureWallet({ rpcUrl: () => node.url });
  }, 90_000);
  afterAll(async () => { await node.stop(); });

  beforeEach(() => {
    advanced = [];
    useWallet.getState().disconnect();
    flow = new TxFlow({
      api: { tx: vi.fn().mockRejectedValue(new Error("no backend in this test")) } as never,
      market: () => (useWallet.getState().wallet ? new MarketClient(address, useWallet.getState().wallet!.signer) : null),
      who: () => (useWallet.getState().wallet ? { address: useWallet.getState().wallet!.address, role: null } : null),
    });
  });

  for (const rule of RULES.filter((r) => !r.scenarioOnly)) {
    it(`${rule.error}: ${rule.title}`, async () => {
      const { txId } = await runRule(rule, await env());
      const tx = flow.get(txId)!;

      // the simulation names exactly the error this rule promises
      expect(tx.simulation).toMatchObject({ ok: false });
      expect(tx.simulation!.ok === false && tx.simulation!.error.name).toBe(rule.error);

      // and it was sent anyway: mined, reverted, with a hash
      expect(tx.forced).toBe(true);
      expect(tx.hash).toMatch(/^0x[0-9a-f]{64}$/);
      const receipt = await node.provider.getTransactionReceipt(tx.hash!);
      expect(receipt!.status).toBe(0);
    }, 30_000);
  }

  it("moves the clock only for the rule that needs it", async () => {
    await runRule(RULES.find((r) => r.error === "ReservationExpired")!, await env());
    expect(advanced).toEqual([24 * 3600 + 5]);
    advanced = [];
    await runRule(RULES.find((r) => r.error === "ReservationNotExpired")!, await env());
    expect(advanced).toEqual([]);
  }, 30_000);

  it("reports progress step by step", async () => {
    const messages: string[] = [];
    await runRule(RULES.find((r) => r.error === "CannotBuyOwnProduct")!, await env({ onProgress: (m) => messages.push(m) }));
    expect(messages).toEqual(["Manufacturer registers a demo product", "Manufacturer lists it for 1 ETH", "Manufacturer buys their own product"]);
  }, 30_000);

  it("refuses to start when mining is not automatic, or for a scenario-only rule", async () => {
    await expect(runRule(RULES[0]!, await env({ automine: false }))).rejects.toThrow(/Switch mining back to Auto/);
    await expect(runRule(RULES.find((r) => r.error === "PaymentFailed")!, await env())).rejects.toBeInstanceOf(RuleError);
  });

  it("explains a setup that failed instead of firing the final call", async () => {
    const rule = RULES.find((r) => r.error === "CannotBuyOwnProduct")!;
    await expect(runRule(rule, await env({ signerFor: async () => { throw new Error("no such account"); } }))).rejects.toThrow(/Could not set the situation up: no such account/);
    expect(flow.state.items).toHaveLength(0);
  }, 30_000);
});
