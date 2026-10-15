import { describe, expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import type { ApiStage, ApiTxDetail, WsMessage } from "@dpp/shared";
import { ApiError } from "@/api/client";
import { actionByFn, buildCall } from "@/web3/actions";
import { TxFlow } from "./txFlow";

const HASH = "0x" + "ab".repeat(32);
const HASH2 = "0x" + "cd".repeat(32);
const ME = { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", role: "Distributor" };
const stage = (key: ApiStage["key"], over: Partial<ApiStage> = {}): ApiStage => ({ key, label: key, at: 1, done: true, current: false, detail: {}, ...over });

const detail = (state: ApiTxDetail["state"], stages: ApiStage[], over: Partial<ApiTxDetail> = {}) =>
  ({ hash: HASH, state, nonce: 5, blockNumber: state === "pending" ? null : 9, gasUsed: "250000", stages, replacedBy: null, explanation: null, ...over }) as ApiTxDetail;

function setup(opts: { sim?: unknown; sendError?: unknown; txs?: ApiTxDetail[]; who?: typeof ME | null; noMarket?: boolean } = {}) {
  let call = 0;
  const txs = opts.txs ?? [detail("pending", [stage("pending")])];
  const market = {
    simulate: vi.fn(async () => (opts.sim ?? { ok: true }) as never),
    send: vi.fn(async (_fn: string, _args: unknown[], o: { force?: boolean }) => {
      if (opts.sendError) throw opts.sendError;
      return { hash: HASH, nonce: 5, response: { wait: vi.fn(), force: o.force } } as never;
    }),
  };
  const api = { tx: vi.fn(async () => txs[Math.min(call++, txs.length - 1)]!) };
  const timers = { fns: [] as (() => void)[], cleared: 0 };
  let t = 1000;
  const flow = new TxFlow({
    api: api as never, market: () => (opts.noMarket ? null : (market as never)), who: () => (opts.who === undefined ? ME : opts.who),
    now: () => (t += 10), pollMs: 1500,
    setTimer: ((fn: () => void) => { timers.fns.push(fn); return timers.fns.length as never; }) as never,
    clearTimer: (() => { timers.cleared++; }) as never,
  });
  const draft = (fn: Parameters<typeof actionByFn>[0] = "buy", form: Record<string, string> = { productId: "1", value: "1" }) => {
    const def = actionByFn(fn);
    return flow.draft(def, buildCall(def, form, []));
  };
  return { flow, market, api, timers, draft };
}
const msg = (type: WsMessage["type"], data: unknown = {}, seq = 1): WsMessage => ({ seq, type, at: 1, data });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("TxFlow: preparing", () => {
  it("encodes the call and describes it", () => {
    const { draft } = setup();
    const tx = draft();
    expect(tx).toMatchObject({ fn: "buy", label: "Buy now", signature: "buy(uint256)", selector: "0xd96a094a", stage: "draft", from: ME.address, fromRole: "Distributor", writesRecord: true });
    expect(tx.calldata.startsWith("0xd96a094a")).toBe(true);
    expect(tx.calldata).toHaveLength(2 + 8 + 64);
    expect(tx.shownArgs).toEqual({ productId: "1" });
    expect(tx.value).toBe(parseEther("1"));
  });

  it("names arguments after the contract's parameters", () => {
    const { draft } = setup();
    const tx = draft("listForSale", { productId: "2", price: "1.5" });
    expect(tx.shownArgs).toEqual({ productId: "2", price: parseEther("1.5").toString() });
  });

  it("refuses to prepare a transaction with nobody acting", () => {
    const { draft } = setup({ who: null });
    expect(() => draft()).toThrow("Choose who you act as");
  });

  it("keeps newest first, remembers the active one, and can remove", () => {
    const { flow, draft } = setup();
    const a = draft();
    const b = draft();
    expect(flow.state.items.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(flow.state.activeId).toBe(b.id);
    flow.setActive(a.id);
    expect(flow.state.activeId).toBe(a.id);
    flow.remove(a.id);
    expect(flow.state.items.map((t) => t.id)).toEqual([b.id]);
    expect(flow.state.activeId).toBeNull();
  });
});

describe("TxFlow: running", () => {
  it("simulates, signs, sends, and follows the transaction until it is verified", async () => {
    const { flow, draft, market, api } = setup({
      txs: [
        detail("pending", [stage("pending")]),
        detail("mined", [stage("pending"), stage("mined"), stage("recorded"), stage("verified", { detail: { status: "intact" } })]),
      ],
    });
    const tx = draft();
    await flow.run(tx.id);
    expect(market.simulate).toHaveBeenCalledWith("buy", [1n], { value: parseEther("1") });
    expect(market.send).toHaveBeenCalledWith("buy", [1n], { value: parseEther("1"), force: undefined });
    await settle();
    expect(flow.get(tx.id)).toMatchObject({ stage: "pending", hash: HASH, nonce: 5, simulation: { ok: true } });

    flow.onMessage(msg("tx.mined", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("mined");
    expect(flow.get(tx.id)!.backend!.stages.map((s) => s.key)).toContain("verified");
    expect(api.tx).toHaveBeenCalledWith(HASH);
    expect(flow.get(tx.id)!.history.map((h) => h.stage)).toEqual(["draft", "simulating", "simulated", "signing", "pending", "mined"]);
  });

  it("stops at a failed simulation and offers to send anyway", async () => {
    const error = { kind: "custom", name: "NotListed", title: "Not for sale", explanation: "x", fix: "y", args: {}, reverts: true };
    const { flow, draft, market } = setup({ sim: { ok: false, error } });
    const tx = draft();
    await flow.run(tx.id);
    expect(market.send).not.toHaveBeenCalled();
    expect(flow.get(tx.id)).toMatchObject({ stage: "simfail", error });

    await flow.sendAnyway(tx.id);
    expect(market.send).toHaveBeenCalledWith("buy", [1n], { value: parseEther("1"), force: true });
    expect(flow.get(tx.id)).toMatchObject({ stage: "pending", forced: true });
  });

  it("follows a forced transaction to its revert", async () => {
    const reverted = detail("failed", [stage("pending"), stage("mined"), stage("explained")]);
    const { flow, draft } = setup({ sim: { ok: false, error: { name: "NotListed" } }, txs: [detail("pending", [stage("pending")]), reverted] });
    const tx = draft();
    await flow.run(tx.id);
    await flow.sendAnyway(tx.id);
    await settle();
    flow.onMessage(msg("tx.failed", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("failed");
  });

  it("recognises a declined signature", async () => {
    const { flow, draft } = setup({ sendError: Object.assign(new Error("user rejected"), { code: "ACTION_REJECTED" }) });
    const tx = draft();
    await flow.run(tx.id);
    expect(flow.get(tx.id)).toMatchObject({ stage: "rejected", hash: null });
    expect(flow.get(tx.id)!.error!.title).toBe("Signature rejected");
  });

  it("reports other send failures with an explanation", async () => {
    const { flow, draft } = setup({ sendError: Object.assign(new Error("funds"), { code: "INSUFFICIENT_FUNDS" }) });
    const tx = draft();
    await flow.run(tx.id);
    expect(flow.get(tx.id)).toMatchObject({ stage: "error" });
    expect(flow.get(tx.id)!.error!.title).toBe("Not enough ETH");
  });

  it("survives a simulation that throws", async () => {
    const { flow, draft, market } = setup();
    market.simulate.mockRejectedValue(new Error("node down"));
    const tx = draft();
    await flow.run(tx.id);
    expect(flow.get(tx.id)!.stage).toBe("error");
  });

  it("does nothing when nobody is connected", async () => {
    const { flow, draft } = setup({ noMarket: true });
    const tx = draft();
    expect(await flow.simulate(tx.id)).toBe(false);
    await flow.submit(tx.id);
    expect(flow.get(tx.id)!.stage).toBe("draft");
  });
});

describe("TxFlow: following the backend", () => {
  async function pending(extra: Parameters<typeof setup>[0] = {}) {
    const s = setup(extra);
    const tx = s.draft();
    await s.flow.run(tx.id);
    await settle();
    s.api.tx.mockClear();
    return { ...s, tx };
  }

  it("ignores messages about other transactions", async () => {
    const { flow, api } = await pending();
    flow.onMessage(msg("tx.mined", { hash: HASH2 }));
    expect(api.tx).not.toHaveBeenCalled();
  });

  it("marks a replaced transaction, and reacts when the replacement is the one mentioned", async () => {
    const { flow, tx } = await pending({ txs: [detail("pending", [stage("pending")]), detail("replaced", [stage("pending"), stage("replaced")], { replacedBy: HASH2 })] });
    flow.onMessage(msg("tx.replaced", { hash: HASH, replacedBy: HASH2 }));
    await settle();
    expect(flow.get(tx.id)).toMatchObject({ stage: "replaced" });
    expect(flow.get(tx.id)!.backend!.replacedBy).toBe(HASH2);
  });

  it("marks a dropped transaction", async () => {
    const { flow, tx } = await pending({ txs: [detail("pending", [stage("pending")]), detail("dropped", [stage("pending"), stage("dropped")])] });
    flow.onMessage(msg("tx.dropped", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("dropped");
  });

  it("picks up the record and its verification when they arrive after mining", async () => {
    const mined = detail("mined", [stage("pending"), stage("mined")]);
    const done = detail("mined", [stage("pending"), stage("mined"), stage("recorded"), stage("verified", { detail: { status: "intact" } })]);
    const { flow, tx } = await pending({ txs: [detail("pending", [stage("pending")]), mined, done] });
    flow.onMessage(msg("tx.mined", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.backend!.stages.map((s) => s.key)).toEqual(["pending", "mined"]);
    flow.onMessage(msg("record.appended", { txHash: HASH, index: "3" }));
    await settle();
    expect(flow.get(tx.id)!.backend!.stages.map((s) => s.key)).toContain("verified");
  });

  it("does not walk back out of a final state because of a stale response", async () => {
    const { flow, tx } = await pending({ txs: [detail("pending", [stage("pending")]), detail("failed", [stage("pending"), stage("mined")]), detail("pending", [stage("pending")])] });
    flow.onMessage(msg("tx.failed", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("failed");
    await flow.refresh(tx.id); // a late, stale "pending"
    expect(flow.get(tx.id)!.stage).toBe("failed");
  });

  it("goes back to pending history when the chain is rewound", async () => {
    const { flow, tx } = await pending({
      txs: [detail("pending", [stage("pending")]), detail("mined", [stage("pending"), stage("mined")]), detail("pending", [stage("pending")])],
    });
    flow.onMessage(msg("tx.mined", { hash: HASH }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("mined");
    flow.onMessage(msg("chain.rewound", { fromBlock: 9, toBlock: 3 }));
    await settle();
    expect(flow.get(tx.id)!.stage).toBe("pending");
  });

  it("copes with the backend not knowing the transaction yet", async () => {
    const s = setup();
    s.api.tx.mockRejectedValue(new ApiError(404, "not_found", "nope"));
    const tx = s.draft();
    await s.flow.run(tx.id);
    await settle();
    expect(s.flow.get(tx.id)).toMatchObject({ stage: "pending", backend: null });
  });

  it("polls unfinished transactions as a safety net, and stops when they are done", async () => {
    const { flow, tx, timers, api } = await pending({ txs: [detail("pending", [stage("pending")]), detail("mined", [stage("pending"), stage("mined")], {})] });
    expect(timers.fns).toHaveLength(1);
    timers.fns[0]!();
    await settle();
    expect(api.tx).toHaveBeenCalled();
    expect(flow.get(tx.id)!.stage).toBe("mined");

    // a mined call that writes a record is unfinished until it is verified; once final, polling stops
    flow.store.setState((s) => ({ items: s.items.map((t) => ({ ...t, writesRecord: false })) }));
    timers.fns[0]!();
    expect(timers.cleared).toBe(1);
  });
});
