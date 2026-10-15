import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiTx } from "@dpp/shared";
import { ApiError } from "@/api/client";
import { AppProviders } from "@/providers";
import { useWallet } from "@/store/wallet";
import { bumpFee, cancelWithWallet } from "@/web3/replace";
import { H, ROLES, session, startFakeController } from "@/test/fakes";
import { MempoolTray } from "./MempoolTray";

const pending = (n: number, over: Partial<ApiTx> = {}): ApiTx => ({
  hash: H(900 + n), from: ROLES[1]!.address, to: ROLES[0]!.address, nonce: n, value: "0", functionName: "buy", args: { productId: "1" }, status: null, state: "pending",
  blockNumber: null, txIndex: null, gasUsed: null, gasLimit: "300000", maxFee: "3000000000", maxPriorityFee: "1000000000", effectiveGasPrice: null, firstSeenAt: 1, minedAt: null,
  replacedBy: null, revert: null, recordIndex: null, ...over,
});

async function mount(txs: ApiTx[] = [pending(4)], lab = { available: true, reason: null as string | null }) {
  const started = await startFakeController({
    session: vi.fn(async () => session({ lab })),
    txs: vi.fn(async () => ({ total: txs.length, txs })),
  });
  started.api.lab.status.mockResolvedValue({ mining: { mode: "manual", automine: false, intervalMs: null }, clients: 1 });
  render(<AppProviders controller={started.controller}><MempoolTray /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}
const row = () => screen.getAllByRole("listitem")[0]!;

beforeEach(() => useWallet.getState().disconnect());

describe("bumpFee", () => {
  it("always pays more than the original", () => {
    expect(bumpFee("3000000000")).toBe(6_000_000_001n);
    expect(bumpFee(null)).toBe(2_000_000_001n);
    expect(bumpFee("0")).toBe(1n);
    expect(bumpFee(null, 5n)).toBe(11n);
  });
});

describe("cancelWithWallet", () => {
  it("sends a 0-ETH transfer to yourself with the same nonce and a higher fee", async () => {
    const sendTransaction = vi.fn(async () => ({ hash: "0xcancel" }));
    const hash = await cancelWithWallet({ sendTransaction } as never, { from: ROLES[1]!.address, nonce: 7, maxFee: "3000000000", maxPriorityFee: "1000000000" });
    expect(hash).toBe("0xcancel");
    expect(sendTransaction).toHaveBeenCalledWith({
      to: ROLES[1]!.address, value: 0n, nonce: 7, gasLimit: 21_000n, maxFeePerGas: 6_000_000_001n, maxPriorityFeePerGas: 2_000_000_001n,
    });
  });
});

describe("MempoolTray: taking a pending transaction back", () => {
  it("explains that a pending transaction is only a request", async () => {
    await mount();
    expect(screen.getByText(/only a request/)).toBeInTheDocument();
    expect(screen.getByText(/the only way to undo it is a new, opposite transaction/)).toBeInTheDocument();
  });

  it("offers speed up, cancel and drop for each pending transaction", async () => {
    await mount([pending(4), pending(5)]);
    const groups = screen.getAllByRole("group", { name: /^Actions for buy/ });
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Speed up", "Cancel", "Drop"]);
  });

  it("speeds up through the lab", async () => {
    const { api } = await mount();
    await userEvent.click(within(row()).getByRole("button", { name: "Speed up" }));
    expect(api.lab.replaceTx).toHaveBeenCalledWith(H(904), "speedUp");
  });

  it("cancels through the lab for a built-in account", async () => {
    const { api } = await mount();
    await userEvent.click(within(row()).getByRole("button", { name: "Cancel" }));
    expect(api.lab.replaceTx).toHaveBeenCalledWith(H(904), "cancel");
  });

  it("drops through the lab", async () => {
    const { api } = await mount();
    await userEvent.click(within(row()).getByRole("button", { name: "Drop" }));
    expect(api.lab.dropTx).toHaveBeenCalledWith(H(904));
  });

  it("cancels with the user's own wallet when it is their transaction", async () => {
    const sendTransaction = vi.fn(async () => ({ hash: "0xcancel" }));
    useWallet.setState({ mode: "metamask", wallet: { kind: "metamask", address: ROLES[1]!.address.toLowerCase(), signer: { sendTransaction } as never, chainId: 31337 } });
    const { api } = await mount();
    await userEvent.click(within(row()).getByRole("button", { name: "Cancel" }));
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ nonce: 4, value: 0n }));
    expect(api.lab.replaceTx).not.toHaveBeenCalled();
  });

  it("uses the lab for someone else's transaction even with MetaMask connected", async () => {
    const sendTransaction = vi.fn();
    useWallet.setState({ mode: "metamask", wallet: { kind: "metamask", address: ROLES[2]!.address, signer: { sendTransaction } as never, chainId: 31337 } });
    const { api } = await mount();
    await userEvent.click(within(row()).getByRole("button", { name: "Cancel" }));
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(api.lab.replaceTx).toHaveBeenCalledWith(H(904), "cancel");
  });

  it("shows why an action failed", async () => {
    const { api } = await mount();
    api.lab.dropTx.mockRejectedValue(new ApiError(409, "not_pending", "That transaction was already mined; it can no longer be dropped or replaced"));
    await userEvent.click(within(row()).getByRole("button", { name: "Drop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already mined");
  });

  it("locks the other buttons while one action is in progress", async () => {
    const { api } = await mount();
    let release!: () => void;
    api.lab.dropTx.mockImplementation(() => new Promise((r) => { release = () => r({ hash: H(904), dropped: true }); }));
    await userEvent.click(within(row()).getByRole("button", { name: "Drop" }));
    expect(within(row()).getByRole("button", { name: "Speed up" })).toBeDisabled();
    release();
    await waitFor(() => expect(within(row()).getByRole("button", { name: "Speed up" })).toBeEnabled());
  });

  it("disables lab actions off the local chain (but a wallet can still cancel its own)", async () => {
    await mount([pending(4)], { available: false, reason: "off" });
    for (const name of ["Speed up", "Cancel", "Drop"]) expect(within(row()).getByRole("button", { name })).toBeDisabled();
  });

  it("leaves a wallet-owned cancel enabled even without the lab", async () => {
    useWallet.setState({ mode: "metamask", wallet: { kind: "metamask", address: ROLES[1]!.address, signer: { sendTransaction: vi.fn() } as never, chainId: 31337 } });
    await mount([pending(4)], { available: false, reason: "off" });
    expect(within(row()).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(row()).getByRole("button", { name: "Drop" })).toBeDisabled();
  });
});
