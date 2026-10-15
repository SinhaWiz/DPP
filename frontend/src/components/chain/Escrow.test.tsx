import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import type { ApiProduct } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { useUi } from "@/store/uiStore";
import { useWallet } from "@/store/wallet";
import { ROLES, session, startFakeController } from "@/test/fakes";
import { EscrowVault } from "./EscrowVault";
import { PullPayments } from "./PullPayments";

const NOW = 1_800_000_000;
const product = (over: Partial<ApiProduct> = {}, expiresAt = String(NOW + 3600)): ApiProduct => ({
  id: "1", name: "Laptop", owner: ROLES[0]!.address, price: parseEther("2").toString(), forSale: true,
  reservation: { buyer: ROLES[1]!.address, amount: parseEther("2").toString(), expiresAt }, ...over,
});

async function mount(ui: React.ReactNode, opts: { lab?: boolean; balances?: object; products?: ApiProduct[] } = {}) {
  const useDemo = vi.fn(async (index: number) => {
    useWallet.setState({ mode: "demo", demoIndex: index, wallet: { kind: "demo", address: ROLES.find((r) => r.index === index)!.address, signer: {} as never, chainId: 31337 } });
  });
  useWallet.setState({ useDemo } as never);

  const started = await startFakeController({
    session: vi.fn(async () => session({ lab: { available: opts.lab ?? true, reason: null } })),
    blocks: vi.fn(async () => ({ blocks: [{ number: 5, hash: "0x" + "11".repeat(32), parentHash: "0x" + "00".repeat(32), timestamp: NOW, txCount: 0, txs: [], records: [] }] })),
    ...(opts.balances ? { balances: vi.fn(async () => opts.balances) } : {}),
  });
  const market = { simulate: vi.fn(async () => ({ ok: true }) as never), send: vi.fn(async () => ({ hash: "0x" + "ab".repeat(32), nonce: 1, response: { wait: vi.fn() } }) as never) };
  const flow = new TxFlow({
    api: { tx: vi.fn().mockRejectedValue(new Error("x")) } as never, market: () => market as never,
    who: () => (useWallet.getState().wallet ? { address: useWallet.getState().wallet!.address, role: null } : null),
  });
  render(<AppProviders controller={started.controller} flow={flow}>{ui}</AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return { ...started, flow, market, useDemo };
}

beforeEach(() => { window.localStorage.clear(); useUi.getState().reset(); useWallet.getState().disconnect(); });

describe("EscrowVault", () => {
  it("shows the buyer, the locked amount and the seller", async () => {
    await mount(<EscrowVault product={product()} />);
    const vault = screen.getByRole("region", { name: "Escrow vault" });
    expect(vault).toHaveTextContent("In escrow: Laptop #1");
    expect(within(vault).getByText("Buyer").nextElementSibling).toHaveTextContent("Distributor");
    expect(within(vault).getByText("Seller").nextElementSibling).toHaveTextContent("Manufacturer");
    expect(within(vault).getByLabelText("The vault")).toHaveTextContent("held by the contract");
    expect(within(vault).getByLabelText(/2 ETH/)).toBeInTheDocument();
  });

  it("explains the deadline and that the product is locked while it is open", async () => {
    await mount(<EscrowVault product={product()} />);
    expect(screen.getByRole("status")).toHaveTextContent("The product is locked");
    expect(screen.getByRole("status")).toHaveTextContent("has until");
  });

  it("renders nothing for a product that is not reserved", async () => {
    await mount(<EscrowVault product={product({ reservation: null })} />);
    expect(screen.queryByRole("region", { name: "Escrow vault" })).not.toBeInTheDocument();
  });

  it("confirms the sale as the seller: switches to that role, then sends confirmSale", async () => {
    const { useDemo, flow, market } = await mount(<EscrowVault product={product()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm sale (seller)" }));
    await waitFor(() => expect(market.send).toHaveBeenCalled());
    expect(useDemo).toHaveBeenCalledWith(0);                       // Manufacturer
    expect(market.send).toHaveBeenCalledWith("confirmSale", [1n], expect.anything());
    expect(flow.state.items[0]).toMatchObject({ fn: "confirmSale", from: ROLES[0]!.address });
    expect(useUi.getState().dockTab).toBe("pipeline");
  });

  it("lets the buyer back out, and the seller decline, each as the right account", async () => {
    const { useDemo, market } = await mount(<EscrowVault product={product()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel (buyer)" }));
    await waitFor(() => expect(market.send).toHaveBeenCalledWith("revokeReservation", [1n], expect.anything()));
    expect(useDemo).toHaveBeenLastCalledWith(1);                   // Distributor, the buyer

    await userEvent.click(screen.getByRole("button", { name: "Reject (seller)" }));
    await waitFor(() => expect(market.send).toHaveBeenCalledWith("rejectReservation", [1n], expect.anything()));
    expect(useDemo).toHaveBeenLastCalledWith(0);
  });

  it("before the deadline the lab can fast-forward the clock; after it the seller can no longer confirm", async () => {
    const open = await mount(<EscrowVault product={product()} />);
    expect(screen.queryByRole("button", { name: /Expire it/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fast-forward one day" }));
    expect(open.api.lab.increaseTime).toHaveBeenCalledWith(24 * 3600 + 1);
  });

  it("once overdue: explains it, hides Confirm, and offers Expire to anyone", async () => {
    const { market } = await mount(<EscrowVault product={product({}, String(NOW - 10))} />);
    expect(screen.getByRole("status")).toHaveTextContent("The deadline passed");
    expect(screen.queryByRole("button", { name: /Confirm sale/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fast-forward one day" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expire it (anyone)" }));
    await waitFor(() => expect(market.send).toHaveBeenCalledWith("expireReservation", [1n], expect.anything()));
  });

  it("hides the clock control where the lab is off", async () => {
    await mount(<EscrowVault product={product()} />, { lab: false });
    expect(screen.queryByRole("button", { name: "Fast-forward one day" })).not.toBeInTheDocument();
  });

  it("says plainly when it cannot act as a party that is not a built-in role", async () => {
    const stranger = "0x" + "77".repeat(20);
    await mount(<EscrowVault product={product({ owner: stranger })} />);
    await userEvent.click(screen.getByRole("button", { name: "Reject (seller)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not one of the built-in roles");
  });

  it("explains that a revocation is a new record, not an erasure", async () => {
    await mount(<EscrowVault product={product()} />);
    expect(screen.getByText(/never erased/)).toBeInTheDocument();
  });
});

describe("PullPayments", () => {
  const balances = (rows: [string, string][], contractBalance = "0") => ({
    balances: ROLES.map((r) => ({ address: r.address, name: r.name, withdrawable: rows.find(([n]) => n === r.name)?.[1] ?? "0", balance: "1" })),
    contractBalance,
  });

  it("shows nothing when nobody is owed anything", async () => {
    await mount(<PullPayments />);
    expect(screen.queryByRole("region", { name: "Pull payments" })).not.toBeInTheDocument();
  });

  it("lists who is owed what, and explains credit versus payment", async () => {
    await mount(<PullPayments />, { balances: balances([["Manufacturer", parseEther("2").toString()], ["Distributor", parseEther("1").toString()]], parseEther("3").toString()) });
    const panel = screen.getByRole("region", { name: "Pull payments" });
    expect(panel).toHaveTextContent("credited, not sent");
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Manufacturer");
    expect(rows[0]).toHaveTextContent("2");
    expect(panel).toHaveTextContent("currently holds");
  });

  it("withdraws as the account that is owed the money", async () => {
    const { market, useDemo } = await mount(<PullPayments />, { balances: balances([["Distributor", "1000"]]) });
    await userEvent.click(screen.getByRole("button", { name: "Withdraw as Distributor" }));
    await waitFor(() => expect(market.send).toHaveBeenCalledWith("withdraw", [], expect.anything()));
    expect(useDemo).toHaveBeenCalledWith(1);
  });

  it("explains the Broken Wallet instead of offering a withdrawal that cannot work", async () => {
    await mount(<PullPayments />, { balances: balances([["Broken Wallet", parseEther("1").toString()], ["Retailer", "5"]]) });
    const rows = within(screen.getByRole("region", { name: "Pull payments" })).getAllByRole("listitem");
    const broken = rows.find((r) => r.textContent!.includes("Broken Wallet"))!;
    expect(broken).toHaveTextContent("WithdrawFailed");
    expect(broken).toHaveTextContent("stays safe");
    expect(within(broken).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw as Retailer" })).toBeInTheDocument();
  });
});
