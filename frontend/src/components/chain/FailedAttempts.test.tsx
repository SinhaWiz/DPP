import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiTx } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { H, ROLES, startFakeController } from "@/test/fakes";
import { FailedAttempts } from "./FailedAttempts";

const tx = (n: number, over: Partial<ApiTx> = {}): ApiTx => ({
  hash: H(800 + n), from: ROLES[1]!.address, to: ROLES[0]!.address, nonce: n, value: "0", functionName: "buy", args: { productId: "1" }, status: 1, state: "mined",
  blockNumber: n, txIndex: 0, gasUsed: "250000", gasLimit: "300000", maxFee: "3", maxPriorityFee: "1", effectiveGasPrice: "2000000000", firstSeenAt: 1, minedAt: 2,
  replacedBy: null, revert: null, recordIndex: String(n), ...over,
});
const failed = (n: number, name = "NotListed") =>
  tx(n, { state: "failed", status: 0, recordIndex: null, revert: { name, args: {}, data: "0x", approximate: false, title: "Not for sale", explanation: "Product #1 is not listed.", fix: "Ask the owner to list it first." } });
const replaced = (n: number) => tx(n, { state: "replaced", status: null, blockNumber: null, recordIndex: null, replacedBy: H(999), functionName: "registerProduct", args: { name: "x" } });
const dropped = (n: number) => tx(n, { state: "dropped", status: null, blockNumber: null, recordIndex: null });

async function mount(initial: ApiTx[]) {
  let current = initial;
  const started = await startFakeController({ txs: vi.fn(async () => ({ total: current.length, txs: current })) });
  const flow = new TxFlow({ api: { tx: vi.fn(async () => ({ ...failed(1), stages: [], events: [], storageWrites: [], record: null, explanation: null })) } as never, market: () => null, who: () => null });
  render(<AppProviders controller={started.controller} flow={flow}><FailedAttempts /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return { ...started, flow, setTxs: (t: ApiTx[]) => { current = t; } };
}

describe("FailedAttempts", () => {
  it("explains what the tray is and what to try when it is empty", async () => {
    await mount([tx(1)]);
    const tray = screen.getByRole("region", { name: "Failed attempts" });
    expect(tray).toHaveTextContent("never reached the ledger");
    expect(tray).toHaveTextContent("None yet");
    expect(within(tray).queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists reverted, replaced and dropped transactions, and leaves out the ones that were recorded", async () => {
    await mount([tx(1), failed(2), replaced(3), dropped(4)]);
    const buttons = within(screen.getByRole("region", { name: "Failed attempts" })).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Reverted: buy, NotListed. Not in the ledger.",
      "Replaced: registerProduct. Not in the ledger.",
      "Dropped: buy. Not in the ledger.",
    ]);
  });

  it("styles failures differently from transactions that never ran", async () => {
    await mount([failed(2), replaced(3), dropped(4)]);
    const [f, r, d] = screen.getAllByRole("button");
    expect(f).toHaveAttribute("data-state", "failed");
    expect(f).toHaveClass("border-tampered");
    expect(r).toHaveClass("border-dashed");
    expect(r!.querySelector(".line-through")).not.toBeNull();   // something that never ran is struck through
    expect(f!.querySelector(".line-through")).toBeNull();       // a reverted one did run
    expect(d).toHaveAttribute("data-state", "dropped");
  });

  it("explains a revert on hover: not in the ledger, why, how to fix it, and the gas that was spent anyway", async () => {
    await mount([failed(2)]);
    await userEvent.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Not in the ledger");
    expect(tip).toHaveTextContent("Product #1 is not listed.");
    expect(tip).toHaveTextContent("Ask the owner to list it first.");
    expect(tip).toHaveTextContent("0.0005 ETH");   // 250000 gas × 2 gwei
    expect(tip).toHaveTextContent("spent anyway");
  });

  it("explains a replaced transaction and what replaced it, with no gas cost", async () => {
    await mount([replaced(3)]);
    await userEvent.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("never mined");
    expect(tip).toHaveTextContent("Replaced by");
    expect(tip).not.toHaveTextContent("Gas paid");
  });

  it("opens the pipeline replay when clicked", async () => {
    const { flow } = await mount([failed(1)]);
    await userEvent.click(screen.getByRole("button", { name: /Reverted/ }));
    await waitFor(() => expect(flow.state.items).toHaveLength(1));
    expect(flow.state.items[0]!.replay).toBe(true);
  });

  describe("a new failure arrives", () => {
    it("animates only the newcomer, then settles", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { controller, setTxs } = await mount([failed(1)]);
        expect(screen.getByRole("button", { name: /Reverted/ })).not.toHaveAttribute("data-fresh");

        setTxs([failed(1), failed(2, "IncorrectPayment")]);
        await act(async () => { await controller.refetchAll(); });
        const fresh = screen.getAllByRole("button").filter((b) => b.hasAttribute("data-fresh"));
        expect(fresh).toHaveLength(1);
        expect(fresh[0]).toHaveAccessibleName(/IncorrectPayment/);

        await act(async () => { vi.advanceTimersByTime(2400); });
        expect(screen.getAllByRole("button").filter((b) => b.hasAttribute("data-fresh"))).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("only highlights for users who prefer reduced motion", async () => {
      window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as never;
      try {
        const { controller, setTxs } = await mount([failed(1)]);
        setTxs([failed(1), failed(2)]);
        await act(async () => { await controller.refetchAll(); });
        const fresh = screen.getAllByRole("button").find((b) => b.hasAttribute("data-fresh"))!;
        expect(fresh).toHaveClass("ring-2");
      } finally {
        window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
      }
    });
  });
});
