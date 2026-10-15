import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiStage, ApiTxDetail } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { actionByFn, buildCall } from "@/web3/actions";
import { ROLES, startFakeController } from "@/test/fakes";
import { TxPipeline } from "./TxPipeline";

const HASH = "0x" + "ab".repeat(32);
const stage = (key: ApiStage["key"], over: Partial<ApiStage> = {}): ApiStage => ({ key, label: key, at: 1700000000000, done: true, current: false, detail: {}, ...over });
const detail = (state: ApiTxDetail["state"], stages: ApiStage[], over: Partial<ApiTxDetail> = {}) =>
  ({ hash: HASH, state, nonce: 2, blockNumber: 9, gasUsed: "250000", stages, replacedBy: null, explanation: null, ...over }) as ApiTxDetail;

async function mount(opts: { sim?: unknown; tx?: ApiTxDetail | Error; hold?: boolean } = {}) {
  const started = await startFakeController();
  const market = {
    simulate: vi.fn(async () => (opts.sim ?? { ok: true }) as never),
    send: vi.fn(async () => ({ hash: HASH, nonce: 2, response: { wait: vi.fn() } }) as never),
  };
  const tx = vi.fn(async () => { if (opts.tx instanceof Error) throw opts.tx; return opts.tx ?? detail("pending", [stage("pending")]); });
  const flow = new TxFlow({ api: { tx } as never, market: () => market as never, who: () => ({ address: ROLES[1]!.address, role: "Distributor" }) });
  render(<AppProviders controller={started.controller} flow={flow}><TxPipeline /></AppProviders>);
  const def = actionByFn("buy");
  const draft = () => flow.draft(def, buildCall(def, { productId: "1", value: "1" }, []));
  return { flow, draft, tx, market };
}

const names = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("TxPipeline", () => {
  it("invites the user to start when there is nothing to show", async () => {
    await mount();
    expect(screen.getByText("No transaction yet")).toBeInTheDocument();
  });

  it("shows a fresh draft with the stages still ahead", async () => {
    const { draft } = await mount();
    await act(async () => { draft(); });
    expect(screen.getByRole("heading", { name: "Buy now" })).toBeInTheDocument();
    expect(screen.getByText("as Distributor")).toBeInTheDocument();
    expect(names()).toEqual(["Draft: done", "Simulated: not reached yet", "Signed & sent: not reached yet"]);
    // with nothing else going on, the details show what is about to be signed
    expect(screen.getByRole("region", { name: "Details: Signed & sent" })).toBeInTheDocument();
  });

  it("follows the transaction as it advances, marking the current stage", async () => {
    const { flow, draft } = await mount();
    let id = "";
    await act(async () => { id = draft().id; await flow.run(id); });
    expect(names().slice(0, 4)).toEqual(["Draft: done", "Simulated: done", "Signed & sent: done", "Pending: in progress"]);
    expect(screen.getByRole("button", { name: /^Pending/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("region", { name: "Details: Pending" })).toHaveTextContent("mempool");
  });

  it("shows the whole journey to a verified record", async () => {
    const { flow, draft } = await mount({
      tx: detail("mined", [stage("pending"), stage("mined"), stage("recorded", { detail: { index: "7", hash: "0xh", prevHash: "0xp" } }), stage("verified", { detail: { status: "intact" } })]),
    });
    await act(async () => { const id = draft().id; await flow.run(id); await flow.refresh(id); });
    expect(names()).toEqual([
      "Draft: done", "Simulated: done", "Signed & sent: done", "Pending: done", "Mined: done", "Record appended: done", "Verified: done",
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^Record appended/ }));
    const details = screen.getByRole("region", { name: "Details: Record appended" });
    expect(within(details).getByText("Ledger index")).toBeInTheDocument();
    expect(within(details).getByText("7")).toBeInTheDocument();
    expect(details).toHaveTextContent("prevHash is the hash of the record before it");
  });

  it("lets the user look at any stage, and stops auto-following once they have", async () => {
    const { flow, draft } = await mount();
    let id = "";
    await act(async () => { id = draft().id; await flow.run(id); });
    await userEvent.click(screen.getByRole("button", { name: /^Draft/ }));
    const region = screen.getByRole("region", { name: "Details: Draft" });
    expect(region).toHaveTextContent("buy(uint256)");
    expect(region).toHaveTextContent("0xd96a094a");
    expect(screen.getByRole("button", { name: /^Draft/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("jumps to the failing stage and explains why nothing was recorded", async () => {
    const { flow, draft } = await mount({
      sim: { ok: false, error: { kind: "custom", name: "NotListed", title: "Not for sale", explanation: "Product #1 is not listed.", fix: "Ask the owner to list it first.", args: {}, reverts: true } },
      tx: detail("failed", [stage("pending"), stage("mined"), stage("explained")], { explanation: { name: "NotListed", explanation: "Product #1 is not listed.", fix: "List it.", title: "Not for sale", args: {}, data: "0x", approximate: false } }),
    });
    await act(async () => { const id = draft().id; await flow.run(id); });
    // the simulation says it would fail: the pipeline stops there
    expect(names()).toEqual(["Draft: done", "Would fail: failed"]);
    expect(screen.getByRole("region", { name: "Details: Would fail" })).toHaveTextContent("Product #1 is not listed.");

    // sent anyway: it runs on the chain and reverts
    await act(async () => { await flow.sendAnyway(flow.state.items[0]!.id); });
    expect(screen.getByText("sent anyway")).toBeInTheDocument();
    expect(names().slice(-2)).toEqual(["Mined (reverted): failed", "Nothing recorded: failed"]);
    // the view jumps to where the story ended, and the earlier stages are one click away
    const ending = screen.getByRole("region", { name: "Details: Nothing recorded" });
    expect(ending).toHaveTextContent("rolls back every change");
    expect(ending).toHaveTextContent("Product #1 is not listed.");
    await userEvent.click(screen.getByRole("button", { name: /^Mined \(reverted\)/ }));
    expect(screen.getByRole("region", { name: "Details: Mined (reverted)" })).toHaveTextContent("0 (reverted)");
  });

  it("switches to a new transaction and forgets which stage was picked for the old one", async () => {
    const { flow, draft } = await mount();
    await act(async () => { draft(); });
    await userEvent.click(screen.getByRole("button", { name: /^Draft/ }));
    expect(screen.getByRole("button", { name: /^Draft/ })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { draft(); });
    expect(screen.getByRole("button", { name: /^Draft/ })).toHaveAttribute("aria-pressed", "false");
    expect(flow.state.items).toHaveLength(2);
  });
});
