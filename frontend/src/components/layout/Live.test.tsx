import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "@/App";
import { AppProviders } from "@/providers";
import { ApiError } from "@/api/client";
import { ADDR, msg, ROLES, session, startFakeController, validChain } from "@/test/fakes";
import { configureWallet, useWallet } from "@/store/wallet";
import type { Eip1193 } from "@/web3/wallet";
import { useUi } from "@/store/uiStore";

vi.mock("@/web3/wallet", async (orig) => {
  const real = await orig<typeof import("@/web3/wallet")>();
  return { ...real, connectDemo: vi.fn(), connectMetaMask: vi.fn(), ensureChain: vi.fn() };
});
import * as walletModule from "@/web3/wallet";

type Started = Awaited<ReturnType<typeof startFakeController>>;

async function mount(over: Record<string, unknown> = {}): Promise<Started> {
  const started = await startFakeController(over);
  render(
    <MemoryRouter>
      <AppProviders controller={started.controller}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  await waitFor(() => expect(started.controller.state.loaded || started.controller.state.link === "offline").toBe(true));
  return started;
}

beforeEach(() => {
  window.localStorage.clear();
  useUi.getState().reset();
  useWallet.getState().disconnect();
  vi.mocked(walletModule.connectDemo).mockReset();
  vi.mocked(walletModule.connectMetaMask).mockReset();
  vi.mocked(walletModule.ensureChain).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("status bar", () => {
  it("shows the backend as live, with the chain and block", async () => {
    await mount();
    const status = await screen.findByRole("status", { name: "Backend Live" });
    expect(status).toHaveTextContent("chain 31337");
    expect(status).toHaveTextContent("block 5");
  });

  it("shows offline, with a prominent explanation and a retry", async () => {
    const started = await mount({ session: vi.fn().mockRejectedValue(new ApiError(0, "unreachable", "Cannot reach the backend")) });
    expect(await screen.findByRole("status", { name: "Backend Offline" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Can't reach the backend");
    expect(alert).toHaveTextContent("npm run dev:backend");

    started.api.session.mockResolvedValue(session());
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "Backend Live" })).toBeInTheDocument();
  });
});

describe("notices", () => {
  it("tells the user when no contract is deployed", async () => {
    await mount({ session: vi.fn(async () => session({ indexer: { state: "waiting-for-deploy", message: "No deployment for this node. Run `npm run dev:deploy`." } })) });
    expect(await screen.findByText("No contract is deployed on this node")).toBeInTheDocument();
    expect(screen.getByText(/npm run dev:deploy/)).toBeInTheDocument();
  });

  it("announces a node restart, can be dismissed, and comes back for the next restart", async () => {
    const s = await mount();
    act(() => s.controller.apply(msg("chain.reset", { reason: "node-restarted" }, 7)));
    expect(await screen.findByText("The local node restarted")).toBeInTheDocument();
    expect(screen.getByText(/Clear activity tab data/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Dismiss: The local node restarted/ }));
    expect(screen.queryByText("The local node restarted")).not.toBeInTheDocument();

    act(() => s.controller.apply(msg("block.new", {}, 8))); // unrelated traffic does not bring it back
    expect(screen.queryByText("The local node restarted")).not.toBeInTheDocument();

    act(() => s.controller.apply(msg("chain.reset", { reason: "node-restarted" }, 9)));
    expect(await screen.findByText("The local node restarted")).toBeInTheDocument();
  });

  it("announces a rewind with the blocks involved", async () => {
    const s = await mount();
    act(() => s.controller.apply(msg("chain.rewound", { fromBlock: 12, toBlock: 7 }, 3)));
    expect(await screen.findByText(/from block 12 to block 7/)).toBeInTheDocument();
  });

  it("warns loudly when the browser's own check disagrees with the server", async () => {
    const records = validChain(3);
    records[1] = { ...records[1]!, price: "999" }; // the data was edited, yet the (lying) server still says "intact"
    const s = await mount();
    s.api.setRecords(records);
    await act(() => s.controller.refetchAll());
    const title = await screen.findByText("Your browser disagrees with the server");
    expect(title.closest('[role="alert"]')).toHaveTextContent("record #1");
  });

  it("stays silent when the server and the browser agree", async () => {
    const s = await mount();
    s.api.setRecordCount(3);
    await act(() => s.controller.refetchAll());
    expect(screen.queryByText("Your browser disagrees with the server")).not.toBeInTheDocument();
  });
});

describe("account switcher", () => {
  const FAKE_WALLET = (index: number) => ({ kind: "demo" as const, address: ROLES[index]!.address, signer: {} as never, chainId: 31337 });

  it("lists the built-in roles (not the broken wallet) and MetaMask", async () => {
    await mount();
    const select = await screen.findByRole("combobox", { name: "Act as" });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose…", "Manufacturer", "Distributor", "Retailer", "MetaMask (my wallet)"]);
  });

  it("connects the chosen role as a demo account and shows its address", async () => {
    vi.mocked(walletModule.connectDemo).mockResolvedValue(FAKE_WALLET(1));
    await mount();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Act as" }), "Distributor");
    await waitFor(() => expect(walletModule.connectDemo).toHaveBeenCalledWith(expect.stringContaining("/rpc"), 1));
    expect(useWallet.getState()).toMatchObject({ mode: "demo", demoIndex: 1 });
    expect(await screen.findByRole("combobox", { name: "Act as" })).toHaveValue("1");
  });

  it("explains a failed connection in the bar", async () => {
    vi.mocked(walletModule.connectDemo).mockRejectedValue(new walletModule.WalletError("unreachable", "Cannot reach the node at /rpc."));
    await mount();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Act as" }), "Manufacturer");
    expect(await screen.findByText(/Cannot reach the node/)).toBeInTheDocument();
  });

  it("connects MetaMask for the chain the app is on", async () => {
    vi.mocked(walletModule.connectMetaMask).mockResolvedValue({ kind: "metamask", address: ADDR(0x99), signer: {} as never, chainId: 31337 });
    configureWallet({ ethereum: () => ({ request: vi.fn() }) as Eip1193 });
    await mount();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Act as" }), "metamask");
    await waitFor(() => expect(walletModule.connectMetaMask).toHaveBeenCalledWith(expect.anything(), { chainId: 31337 }));
    expect(useWallet.getState().mode).toBe("metamask");
  });

  it("flags a wallet on the wrong network and switches it on request", async () => {
    vi.mocked(walletModule.ensureChain).mockResolvedValue();
    configureWallet({ ethereum: () => ({ request: vi.fn() }) as Eip1193 });
    await mount();
    act(() => useWallet.setState({ mode: "metamask", chainId: 1, wallet: { kind: "metamask", address: ADDR(1), signer: {} as never, chainId: 1 } }));

    const alert = await screen.findByText("Your wallet is on the wrong network");
    expect(alert.closest('[role="alert"]')).toHaveTextContent("chain 1");
    await userEvent.click(screen.getByRole("button", { name: "Switch network" }));
    await waitFor(() => expect(walletModule.ensureChain).toHaveBeenCalledWith(expect.anything(), { chainId: 31337 }));
    await waitFor(() => expect(screen.queryByText("Your wallet is on the wrong network")).not.toBeInTheDocument());
  });
});
