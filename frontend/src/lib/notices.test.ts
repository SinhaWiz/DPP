import { describe, expect, it } from "vitest";
import type { ApiSession, WsMessage } from "@dpp/shared";
import { computeNotices, type NoticeInput } from "./notices";

const session = (over: Partial<ApiSession> = {}, indexer = { state: "live", message: null as string | null }): ApiSession =>
  ({
    chainId: 31337, sessionId: null, contracts: null, deployBlock: null, headBlock: 1, indexedBlock: 1, indexer, ledgerLength: 0, productCount: 0,
    seq: 0, roles: [], mining: { automine: true }, lab: { available: true, reason: null }, features: { debugTrace: true }, ...over,
  }) as ApiSession;

const base: NoticeInput = { link: "live", loaded: true, session: session(), walletChainId: null, lastReset: null, lastRewind: null, comparison: null };
const ids = (i: Partial<NoticeInput>) => computeNotices({ ...base, ...i }).map((n) => n.id);
const msg = (type: WsMessage["type"], data: unknown, seq = 4): WsMessage => ({ seq, type, at: 1, data });

describe("computeNotices", () => {
  it("is quiet when everything is fine", () => {
    expect(computeNotices(base)).toEqual([]);
  });

  it("says the backend is unreachable, differently the first time and after losing it", () => {
    const first = computeNotices({ ...base, link: "offline", loaded: false, session: null })[0]!;
    expect(first).toMatchObject({ id: "backend-offline", level: "error", title: "Can't reach the backend", action: { kind: "retry" } });
    expect(first.body).toContain("npm run dev:backend");
    expect(computeNotices({ ...base, link: "offline", loaded: true })[0]!.title).toBe("Lost the connection to the backend");
  });

  it("does not also complain about the node when the backend itself is down", () => {
    expect(ids({ link: "offline", session: session({}, { state: "waiting-for-node", message: "x" }) })).toEqual(["backend-offline"]);
  });

  it("explains a missing node and a missing deployment with the command to fix each", () => {
    const node = computeNotices({ ...base, session: session({}, { state: "waiting-for-node", message: "Start it with `npm run dev:node`." }) });
    expect(node[0]).toMatchObject({ id: "node-down", level: "error" });
    expect(node[0]!.body).toContain("dev:node");
    const deploy = computeNotices({ ...base, session: session({}, { state: "waiting-for-deploy", message: null }) });
    expect(deploy[0]).toMatchObject({ id: "no-deployment", level: "warning" });
    expect(deploy[0]!.body).toContain("dev:deploy");
  });

  it("warns when the wallet is on another chain, and offers to switch", () => {
    const n = computeNotices({ ...base, walletChainId: 1 })[0]!;
    expect(n).toMatchObject({ id: "wrong-network", level: "error", action: { kind: "switch-network" } });
    expect(n.body).toContain("chain 1");
    expect(n.body).toContain("31337");
    expect(ids({ walletChainId: 31337 })).toEqual([]);
    expect(ids({ walletChainId: null })).toEqual([]);
  });

  it("flags a disagreement between browser and server, naming the first record", () => {
    const n = computeNotices({
      ...base,
      comparison: { agree: false, diffs: [{ index: "4", browser: "dataTampered", server: "intact" }, { index: "5", browser: "linkBroken", server: "intact" }] },
    })[0]!;
    expect(n).toMatchObject({ id: "verify-disagree", level: "error", dismissible: false });
    expect(n.body).toContain("record #4");
    expect(n.body).toContain("and 1 more");
    expect(ids({ comparison: { agree: true, diffs: [] } })).toEqual([]);
  });

  it("announces a restarted node or a redeploy, with the MetaMask tip", () => {
    const restarted = computeNotices({ ...base, lastReset: msg("chain.reset", { reason: "node-restarted" }, 9) })[0]!;
    expect(restarted).toMatchObject({ id: "chain-reset", version: 9, level: "info", dismissible: true, title: "The local node restarted" });
    expect(restarted.body).toContain("Clear activity tab data");
    expect(computeNotices({ ...base, lastReset: msg("chain.reset", { reason: "redeployed" }) })[0]!.title).toBe("The contract was redeployed");
  });

  it("announces a rewind with the block range", () => {
    const n = computeNotices({ ...base, lastRewind: msg("chain.rewound", { fromBlock: 12, toBlock: 7 }, 11) })[0]!;
    expect(n).toMatchObject({ id: "chain-rewound", version: 11 });
    expect(n.body).toContain("from block 12 to block 7");
  });

  it("lists the most urgent first", () => {
    const order = ids({
      link: "offline", walletChainId: 1, lastReset: msg("chain.reset", {}),
      comparison: { agree: false, diffs: [{ index: "1", browser: "dataTampered", server: "intact" }] },
    });
    expect(order).toEqual(["backend-offline", "wrong-network", "verify-disagree", "chain-reset"]);
  });
});
