import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiTx } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { MiningControl } from "@/components/layout/MiningControl";
import { ApiError } from "@/api/client";
import { H, ROLES, msg, session, startFakeController } from "@/test/fakes";
import { MempoolTray } from "./MempoolTray";

const pendingTx = (n: number, over: Partial<ApiTx> = {}): ApiTx => ({
  hash: H(900 + n), from: ROLES[1]!.address, to: ROLES[0]!.address, nonce: n, value: "0", functionName: "buy", args: { productId: "1" }, status: null, state: "pending",
  blockNumber: null, txIndex: null, gasUsed: null, gasLimit: "300000", maxFee: "3", maxPriorityFee: "1", effectiveGasPrice: null, firstSeenAt: 1, minedAt: null,
  replacedBy: null, revert: null, recordIndex: null, ...over,
});

async function mount(ui: React.ReactNode, opts: { mining?: object; txs?: ApiTx[]; lab?: { available: boolean; reason: string | null } } = {}) {
  const started = await startFakeController({
    session: vi.fn(async () => session({ lab: opts.lab ?? { available: true, reason: null } })),
    txs: vi.fn(async () => ({ total: (opts.txs ?? []).length, txs: opts.txs ?? [] })),
  });
  if (opts.mining) started.api.lab.status.mockResolvedValue({ mining: opts.mining as never, clients: 1 });
  render(<AppProviders controller={started.controller}>{ui}</AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}

const manual = { mode: "manual", automine: false, intervalMs: null };

describe("MiningControl", () => {
  it("shows the current mode and offers the three modes", async () => {
    await mount(<MiningControl />);
    const group = screen.getByRole("group", { name: "Mining mode" });
    expect(within(group).getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Step" })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "Slow" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to step mode, and the new state arrives from the server", async () => {
    const { api, controller } = await mount(<MiningControl />);
    await userEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(api.lab.setMining).toHaveBeenCalledWith("manual", undefined);
    act(() => controller.apply(msg("mining.changed", manual)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Step" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("slow motion asks for a block every few seconds", async () => {
    const { api } = await mount(<MiningControl />);
    await userEvent.click(screen.getByRole("button", { name: "Slow" }));
    expect(api.lab.setMining).toHaveBeenCalledWith("interval", 3000);
  });

  it("can mine by hand only in step mode, and says how many are waiting", async () => {
    const { api } = await mount(<MiningControl />, { mining: manual, txs: [pendingTx(1), pendingTx(2)] });
    const mine = screen.getByRole("button", { name: /Mine block/ });
    expect(mine).toHaveTextContent("2 waiting");
    expect(mine).toBeEnabled();
    await userEvent.click(mine);
    expect(api.lab.mine).toHaveBeenCalledWith(1);
  });

  it("disables hand mining on automatic mode, explaining how to enable it", async () => {
    await mount(<MiningControl />);
    const mine = screen.getByRole("button", { name: /Mine block/ });
    expect(mine).toBeDisabled();
    expect(mine).toHaveAttribute("title", expect.stringContaining("Step mode"));
  });

  it("reports a failure instead of swallowing it", async () => {
    const { api } = await mount(<MiningControl />, { mining: manual });
    api.lab.mine.mockRejectedValue(new ApiError(403, "lab_unavailable", "The lab is off"));
    await userEvent.click(screen.getByRole("button", { name: /Mine block/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The lab is off");
  });

  it("explains that it cannot control mining where the lab is off", async () => {
    await mount(<MiningControl />, { lab: { available: false, reason: "Lab features are disabled on chain 1" } });
    expect(screen.queryByRole("group", { name: "Mining mode" })).not.toBeInTheDocument();
    expect(screen.getByText("Mining: not controllable here")).toHaveAttribute("title", "Lab features are disabled on chain 1");
  });
});

describe("MempoolTray", () => {
  it("explains why it is empty on automatic mining", async () => {
    await mount(<MempoolTray />);
    expect(screen.getByText("Nothing is waiting")).toBeInTheDocument();
    expect(screen.getByText(/mined the moment it is sent/)).toBeInTheDocument();
  });

  it("says something different when nothing is waiting in step mode", async () => {
    await mount(<MempoolTray />, { mining: manual });
    expect(screen.getByText(/Send a transaction and it waits here/)).toBeInTheDocument();
  });

  it("lists transactions waiting for a block, with their nonce and call", async () => {
    await mount(<MempoolTray />, { mining: manual, txs: [pendingTx(4, { value: (10n ** 18n).toString() }), pendingTx(5, { state: "mined", blockNumber: 3 })] });
    const list = screen.getByRole("list", { name: "Pending transactions" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1); // the mined one is not waiting
    expect(rows[0]).toHaveTextContent("buy(1)");
    expect(rows[0]).toHaveTextContent("nonce 4");
    expect(rows[0]).toHaveTextContent("Distributor");
    expect(screen.getByText(/1 transaction waiting/)).toBeInTheDocument();
  });

  it("offers to mine them in step mode", async () => {
    const { api } = await mount(<MempoolTray />, { mining: manual, txs: [pendingTx(1), pendingTx(2)] });
    expect(screen.getByText(/2 transactions waiting/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mine them now" }));
    expect(api.lab.mine).toHaveBeenCalledWith(1);
  });

  it("does not offer mining outside step mode", async () => {
    await mount(<MempoolTray />, { txs: [pendingTx(1)] });
    expect(screen.queryByRole("button", { name: "Mine them now" })).not.toBeInTheDocument();
  });
});
