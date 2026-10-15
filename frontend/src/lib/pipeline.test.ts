import { describe, expect, it } from "vitest";
import type { ApiStage, ApiTxDetail, ErrorExplanation } from "@dpp/shared";
import type { FlowTx } from "@/store/flowTypes";
import { focusNode, isFinal, pipelineNodes } from "./pipeline";

const flow = (over: Partial<FlowTx> = {}): FlowTx => ({
  id: "t1", fn: "buy", label: "Buy now", args: [1n], shownArgs: { productId: "1" }, value: 10n ** 18n, writesRecord: true,
  from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", fromRole: "Distributor", calldata: "0xd96a094a" + "00".repeat(31) + "01", selector: "0xd96a094a",
  signature: "buy(uint256)", stage: "draft", simulation: null, forced: false, hash: null, nonce: null, backend: null, error: null,
  history: [{ stage: "draft", at: 1000 }], ...over,
});

const stage = (key: ApiStage["key"], over: Partial<ApiStage> = {}): ApiStage => ({ key, label: key, at: 2000, done: true, current: false, detail: {}, ...over });
const backend = (stages: ApiStage[], over: Partial<ApiTxDetail> = {}): ApiTxDetail =>
  ({ blockNumber: 7, gasUsed: "250000", gasLimit: "300000", maxFee: "3000000000", replacedBy: null, stages, explanation: null, ...over }) as ApiTxDetail;

const explanation: ErrorExplanation = { kind: "custom", name: "NotListed", title: "Not for sale", explanation: "It is not listed.", fix: "List it first.", args: {}, reverts: true };
const keys = (tx: FlowTx) => pipelineNodes(tx).map((n) => `${n.key}:${n.status}`);

describe("pipelineNodes", () => {
  it("a fresh draft shows the encoded call and a simulation still ahead", () => {
    const nodes = pipelineNodes(flow());
    expect(keys(flow())).toEqual(["draft:done", "simulated:upcoming", "signed:upcoming"]);
    expect(nodes[0]!.explain).toContain("0xd96a094a");
    expect(nodes[0]!.explain).toContain("buy(uint256)");
    expect(nodes[0]!.detail).toContainEqual(["Sends", "1 ETH"]);
    expect(nodes[0]!.detail).toContainEqual(["productId", "1"]);
  });

  it("marks the simulation as in progress, then done", () => {
    expect(keys(flow({ stage: "simulating" }))[1]).toBe("simulated:current");
    expect(keys(flow({ stage: "simulated", simulation: { ok: true } }))).toEqual(["draft:done", "simulated:done", "signed:upcoming"]);
  });

  it("stops at a failed simulation and says why", () => {
    const tx = flow({ stage: "simfail", simulation: { ok: false, error: explanation } });
    expect(keys(tx)).toEqual(["draft:done", "simulated:failed"]);
    const sim = pipelineNodes(tx)[1]!;
    expect(sim.label).toBe("Would fail");
    expect(sim.detail).toContainEqual(["Error", "NotListed"]);
    expect(sim.detail).toContainEqual(["Fix", "List it first."]);
  });

  it("continues past a failed simulation when the user sent it anyway", () => {
    const tx = flow({ stage: "pending", forced: true, hash: "0x" + "ab".repeat(32), nonce: 3, simulation: { ok: false, error: explanation } });
    expect(keys(tx)).toEqual(["draft:done", "simulated:failed", "signed:done", "pending:current", "mined:upcoming"]);
    expect(pipelineNodes(tx)[2]!.detail).toContainEqual(["Note", "sent anyway, with a fixed gas limit"]);
  });

  it("shows a declined signature as the failing step", () => {
    const tx = flow({ stage: "rejected", simulation: { ok: true }, error: { ...explanation, title: "Signature rejected", explanation: "The signing request was declined.", fix: "Approve it." } });
    expect(keys(tx)).toEqual(["draft:done", "simulated:done", "signed:failed"]);
    expect(pipelineNodes(tx)[2]!.label).toBe("Not signed");
    expect(focusNode(pipelineNodes(tx)).key).toBe("signed");
  });

  it("waits in the mempool", () => {
    const tx = flow({ stage: "pending", hash: "0x" + "ab".repeat(32), nonce: 4, simulation: { ok: true } });
    expect(keys(tx)).toEqual(["draft:done", "simulated:done", "signed:done", "pending:current", "mined:upcoming"]);
    expect(pipelineNodes(tx)[2]!.detail).toContainEqual(["Nonce", "4"]);
    expect(focusNode(pipelineNodes(tx)).key).toBe("pending");
  });

  it("goes all the way: mined, record appended, verified", () => {
    const tx = flow({
      stage: "mined", hash: "0x" + "ab".repeat(32), nonce: 4, simulation: { ok: true },
      backend: backend([stage("pending"), stage("mined"), stage("recorded", { detail: { index: "12", hash: "0xh", prevHash: "0xp" } }), stage("verified", { detail: { status: "intact" } })]),
    });
    expect(keys(tx)).toEqual(["draft:done", "simulated:done", "signed:done", "pending:done", "mined:done", "recorded:done", "verified:done"]);
    expect(pipelineNodes(tx).find((n) => n.key === "recorded")!.detail).toContainEqual(["Ledger index", "12"]);
    expect(isFinal(tx)).toBe(true);
  });

  it("is still verifying until the backend says so", () => {
    const tx = flow({ stage: "mined", hash: "0xa", simulation: { ok: true }, backend: backend([stage("pending"), stage("mined"), stage("recorded"), stage("verified", { done: false, detail: {} })].slice(0, 3)) });
    expect(keys(tx).slice(-2)).toEqual(["recorded:done", "verified:current"]);
    expect(isFinal(tx)).toBe(false);
  });

  it("flags a record that failed verification", () => {
    const tx = flow({ stage: "mined", hash: "0xa", simulation: { ok: true }, backend: backend([stage("pending"), stage("mined"), stage("recorded"), stage("verified", { detail: { status: "dataTampered" } })]) });
    const last = pipelineNodes(tx).at(-1)!;
    expect(last).toMatchObject({ key: "verified", status: "failed", label: "Verification failed" });
  });

  it("a call that writes no record ends at 'Mined'", () => {
    const tx = flow({ fn: "withdraw", writesRecord: false, stage: "mined", hash: "0xa", simulation: { ok: true }, backend: backend([stage("pending"), stage("mined")]) });
    expect(keys(tx).at(-1)).toBe("mined:done");
    expect(isFinal(tx)).toBe(true);
  });

  it("a reverted transaction ends in 'Nothing recorded', with the reason", () => {
    const tx = flow({ stage: "failed", forced: true, hash: "0xa", simulation: { ok: false, error: explanation }, backend: backend([stage("pending"), stage("mined")], { explanation: { ...explanation, args: {}, approximate: false, data: "0x", title: "t" } as never }) });
    expect(keys(tx).slice(-2)).toEqual(["mined:failed", "failed:failed"]);
    const last = pipelineNodes(tx).at(-1)!;
    expect(last.label).toBe("Nothing recorded");
    expect(last.detail).toContainEqual(["Error", "NotListed"]);
    expect(last.explain).toContain("rolls back every change");
    expect(pipelineNodes(tx).find((n) => n.key === "mined")!.label).toBe("Mined (reverted)");
  });

  it("replaced and dropped transactions never reach a block", () => {
    const base = { hash: "0xa", simulation: { ok: true } as const, history: [{ stage: "draft" as const, at: 1 }] };
    const replaced = flow({ ...base, stage: "replaced", backend: backend([stage("pending"), stage("replaced")], { replacedBy: "0xnew" }) });
    expect(keys(replaced).slice(-2)).toEqual(["pending:done", "replaced:failed"]);
    expect(pipelineNodes(replaced).at(-1)!.detail).toContainEqual(["Replaced by", "0xnew"]);
    const dropped = flow({ ...base, stage: "dropped" });
    expect(pipelineNodes(dropped).at(-1)).toMatchObject({ key: "dropped", status: "failed" });
    expect(pipelineNodes(dropped).at(-1)!.explain).toContain("nothing was recorded");
  });

  it("an error before sending is a failed 'signed' step with the explanation", () => {
    const tx = flow({ stage: "error", simulation: { ok: true }, error: { ...explanation, title: "Not enough ETH", explanation: "Cannot cover the gas.", fix: "Use another account." } });
    expect(keys(tx)).toEqual(["draft:done", "simulated:done", "signed:failed"]);
    expect(pipelineNodes(tx)[2]!.detail).toContainEqual(["Why", "Cannot cover the gas."]);
  });
});

describe("focusNode / isFinal", () => {
  it("shows the latest failure when the story went on past an earlier one", () => {
    const tx = flow({ stage: "failed", forced: true, hash: "0xa", simulation: { ok: false, error: explanation }, backend: backend([stage("pending"), stage("mined")]) });
    expect(focusNode(pipelineNodes(tx)).key).toBe("failed"); // not the failed simulation before it
  });
  it("prefers the failing node, then the current one, then the last", () => {
    expect(focusNode(pipelineNodes(flow({ stage: "pending", hash: "0xa", simulation: { ok: true } }))).key).toBe("pending");
    expect(focusNode(pipelineNodes(flow({ stage: "draft" }))).key).toBe("signed");
  });
  it("only terminal stages are final", () => {
    for (const s of ["draft", "simulating", "simulated", "signing", "pending"] as const) expect(isFinal(flow({ stage: s }))).toBe(false);
    for (const s of ["failed", "replaced", "dropped", "rejected", "error", "simfail"] as const) expect(isFinal(flow({ stage: s }))).toBe(true);
  });
});
