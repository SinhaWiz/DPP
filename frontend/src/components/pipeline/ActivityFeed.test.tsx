import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiStage, ApiTx, ApiTxDetail } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { useUi } from "@/store/uiStore";
import { H, ROLES, startFakeController } from "@/test/fakes";
import { ActivityFeed } from "./ActivityFeed";
import { TxPipeline } from "./TxPipeline";
import { pipelineNodes } from "@/lib/pipeline";

const tx = (n: number, over: Partial<ApiTx> = {}): ApiTx => ({
  hash: H(700 + n), from: ROLES[1]!.address, to: ROLES[0]!.address, nonce: n, value: "0", functionName: "buy", args: { productId: "1" }, status: 1, state: "mined",
  blockNumber: n, txIndex: 0, gasUsed: "250000", gasLimit: "300000", maxFee: "3", maxPriorityFee: "1", effectiveGasPrice: "2", firstSeenAt: 1_700_000_000_000 + n * 1000,
  minedAt: 1_700_000_000_500 + n * 1000, replacedBy: null, revert: null, recordIndex: String(n), ...over,
});
const stage = (key: ApiStage["key"], over: Partial<ApiStage> = {}): ApiStage => ({ key, label: key, at: 1, done: true, current: false, detail: {}, ...over });
const detailOf = (t: ApiTx, stages: ApiStage[], over: Partial<ApiTxDetail> = {}) => ({ ...t, stages, events: [], storageWrites: [], record: null, explanation: null, ...over }) as ApiTxDetail;

const txs = [
  tx(1),
  tx(2, { functionName: "listForSale", args: { productId: "2", price: "1" }, from: ROLES[0]!.address }),
  tx(3, { state: "failed", status: 0, recordIndex: null, revert: { name: "NotListed", args: {}, data: "0x", approximate: false, title: "Not for sale", explanation: "e", fix: "f" } }),
  tx(4, { state: "dropped", status: null, blockNumber: null, recordIndex: null }),
];

async function mount(opts: { detail?: (hash: string) => ApiTxDetail } = {}) {
  const started = await startFakeController({
    txs: vi.fn(async () => ({ total: 57, txs })),
    products: vi.fn(async () => ({ products: [
      { id: "1", name: "Laptop", owner: ROLES[0]!.address, price: "0", forSale: false, reservation: null },
      { id: "2", name: "Phone", owner: ROLES[0]!.address, price: "0", forSale: false, reservation: null },
    ] })),
  });
  const apiTx = vi.fn(async (hash: string) => (opts.detail ? opts.detail(hash) : detailOf(txs.find((t) => t.hash === hash)!, [stage("pending"), stage("mined")])));
  const flow = new TxFlow({ api: { tx: apiTx } as never, market: () => null, who: () => null });
  render(<AppProviders controller={started.controller} flow={flow}><ActivityFeed /><TxPipeline /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return { ...started, flow, apiTx };
}

beforeEach(() => { window.localStorage.clear(); useUi.getState().reset(); });

/** The replay button of the n-th row in the list (the fixture has several `buy` calls). */
const replay = async (n: number) =>
  userEvent.click(within(within(screen.getByRole("list", { name: "Transactions" })).getAllByRole("listitem")[n]!).getByRole("button", { name: /^Replay/ }));

describe("ActivityFeed", () => {
  it("lists every kind of transaction with its state, call, sender and outcome", async () => {
    await mount();
    const rows = within(screen.getByRole("list", { name: "Transactions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("buy(1)");
    expect(rows[0]).toHaveTextContent("Distributor");
    expect(rows[0]).toHaveTextContent("→ record #1");
    expect(rows[1]).toHaveTextContent("listForSale(2, 1)");
    expect(rows[2]).toHaveTextContent("Failed");
    expect(rows[2]).toHaveTextContent("NotListed");
    expect(rows[3]).toHaveTextContent("Dropped");
    expect(screen.getByText("Showing 4 of 57")).toBeInTheDocument();
  });

  it("filters by state, account and product, and combines them", async () => {
    await mount();
    const rowCount = () => within(screen.getByRole("list", { name: "Transactions" })).getAllByRole("listitem").length;

    await userEvent.selectOptions(screen.getByLabelText("State"), "failed");
    expect(rowCount()).toBe(1);
    await userEvent.selectOptions(screen.getByLabelText("State"), "");

    await userEvent.selectOptions(screen.getByLabelText("Account"), ROLES[0]!.address);
    expect(rowCount()).toBe(1);
    expect(screen.getByRole("list", { name: "Transactions" })).toHaveTextContent("listForSale");
    await userEvent.selectOptions(screen.getByLabelText("Account"), "");

    await userEvent.selectOptions(screen.getByLabelText("Product"), "2");
    expect(rowCount()).toBe(1);

    await userEvent.selectOptions(screen.getByLabelText("State"), "dropped");
    expect(screen.getByText("No transaction matches these filters.")).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 57")).toBeInTheDocument();
  });

  it("shows an empty state before there is anything", async () => {
    const started = await startFakeController();
    render(<AppProviders controller={started.controller} flow={new TxFlow({ api: {} as never, market: () => null, who: () => null })}><ActivityFeed /></AppProviders>);
    await waitFor(() => expect(started.controller.state.loaded).toBe(true));
    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
  });

  describe("replaying a transaction", () => {
    it("opens its pipeline and switches the dock to it", async () => {
      useUi.getState().setDockTab("activity");
      const { flow } = await mount({ detail: (h) => detailOf(txs.find((t) => t.hash === h)!, [stage("pending"), stage("mined"), stage("recorded", { detail: { index: "1" } }), stage("verified", { detail: { status: "intact" } })]) });
      await replay(0);
      await waitFor(() => expect(flow.state.items).toHaveLength(1));
      expect(useUi.getState().dockTab).toBe("pipeline");
      const t = flow.state.items[0]!;
      expect(t).toMatchObject({ replay: true, stage: "mined", label: "buy", signature: "buy(uint256)" });
      expect(screen.getByRole("heading", { name: "buy" })).toBeInTheDocument();
      // a past transaction starts at "Call", then "Sent": there was no browser-side simulation
      expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")).filter(Boolean)).toContain("Call: done");
      expect(screen.queryByRole("button", { name: /^Simulated/ })).not.toBeInTheDocument();
    });

    it("replays a failed transaction down to the reason nothing was recorded", async () => {
      const failed = txs[2]!;
      const { flow } = await mount({
        detail: () => detailOf(failed, [stage("pending"), stage("mined"), stage("explained")], {
          explanation: { name: "NotListed", args: {}, data: "0x", approximate: false, title: "Not for sale", explanation: "Product #1 is not listed.", fix: "List it first." },
        }),
      });
      await replay(2);
      await waitFor(() => expect(flow.state.items).toHaveLength(1));
      const nodes = pipelineNodes(flow.state.items[0]!);
      expect(nodes.map((n) => `${n.key}:${n.status}`)).toEqual(["draft:done", "signed:done", "pending:done", "mined:failed", "failed:failed"]);
      expect(await screen.findByRole("region", { name: "Details: Nothing recorded" })).toHaveTextContent("Product #1 is not listed.");
    });

    it("replays a dropped transaction", async () => {
      const dropped = txs[3]!;
      const { flow } = await mount({ detail: () => detailOf(dropped, [stage("pending"), stage("dropped")]) });
      await replay(3);
      await waitFor(() => expect(flow.state.items[0]?.stage).toBe("dropped"));
      expect(screen.getByRole("region", { name: "Details: Dropped" })).toHaveTextContent("never ran");
    });

    it("shows the same transaction again instead of duplicating it", async () => {
      const { flow, apiTx } = await mount();
      await replay(0);
      await waitFor(() => expect(flow.state.items).toHaveLength(1));
      await replay(0);
      expect(flow.state.items).toHaveLength(1);
      expect(apiTx.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("reports a transaction the backend cannot find", async () => {
      await mount({ detail: () => { throw new Error("Transaction not found"); } });
      await replay(0);
      expect(await screen.findByRole("alert")).toHaveTextContent("Transaction not found");
    });
  });
});
