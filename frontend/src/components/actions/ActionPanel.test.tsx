import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import type { ApiProduct } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { getTxFlow } from "@/store/flowInstance";
import { TxFlow } from "@/store/txFlow";
import { useUi } from "@/store/uiStore";
import { useWallet } from "@/store/wallet";
import { ROLES, startFakeController } from "@/test/fakes";
import { ActionPanel } from "./ActionPanel";

const ME = ROLES[1]!.address; // Distributor
const OWNER = ROLES[0]!.address;
const product = (over: Partial<ApiProduct> = {}): ApiProduct => ({ id: "1", name: "Laptop", owner: OWNER, price: parseEther("1").toString(), forSale: true, reservation: null, ...over });

async function mount(opts: { products?: ApiProduct[]; connected?: boolean; sim?: unknown; sendError?: unknown } = {}) {
  const started = await startFakeController({ products: vi.fn(async () => ({ products: opts.products ?? [product()] })) });
  const market = {
    simulate: vi.fn(async () => (opts.sim ?? { ok: true }) as never),
    send: vi.fn(async () => {
      if (opts.sendError) throw opts.sendError;
      return { hash: "0x" + "ab".repeat(32), nonce: 1, response: { wait: vi.fn() } } as never;
    }),
  };
  const flow = new TxFlow({
    api: { tx: vi.fn().mockRejectedValue(new Error("unknown")) } as never,
    market: () => market as never,
    who: () => (useWallet.getState().wallet ? { address: useWallet.getState().wallet!.address, role: "Distributor" } : null),
  });
  useWallet.setState(opts.connected === false ? { wallet: null, mode: "none" } : { wallet: { kind: "demo", address: ME, signer: {} as never, chainId: 31337 }, mode: "demo", demoIndex: 1 });
  render(
    <AppProviders controller={started.controller} flow={flow}>
      <ActionPanel />
    </AppProviders>,
  );
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return { ...started, market, flow };
}

const radio = (name: RegExp | string) => screen.getByRole("radio", { name });
const status = () => screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite" && el.tagName === "P");

beforeEach(() => {
  window.localStorage.clear();
  useUi.getState().reset();
  useWallet.getState().disconnect();
});

describe("ActionPanel", () => {
  it("says who is acting, or asks the user to choose", async () => {
    await mount();
    expect(screen.getByText(/Acting as/)).toHaveTextContent("Distributor");
    await act(async () => useWallet.getState().disconnect());
    expect(screen.getAllByText(/Choose who you act as/).length).toBeGreaterThanOrEqual(1);
  });

  it("lists every action and describes the selected one", async () => {
    await mount();
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    expect(radio("Register a product")).toBeChecked();
    expect(screen.getByText(/Create a product/)).toBeInTheDocument();
    await userEvent.click(radio("Buy now"));
    expect(screen.getByText(/Pay the exact price/)).toBeInTheDocument();
  });

  it("shows only the fields an action needs", async () => {
    await mount();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    await userEvent.click(radio("List for sale"));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product")).toBeInTheDocument();
    expect(screen.getByLabelText("Price (ETH)")).toBeInTheDocument();
    await userEvent.click(radio("Withdraw funds"));
    expect(screen.queryByLabelText("Product")).not.toBeInTheDocument();
  });

  it("offers the products that exist, with price and reservation hints", async () => {
    await mount({ products: [product(), product({ id: "2", name: "Phone", forSale: false, price: "0" }), product({ id: "3", name: "Tablet", reservation: { buyer: ME, amount: "1", expiresAt: "9" } })] });
    await userEvent.click(radio("Buy now"));
    const options = within(screen.getByLabelText("Product")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a product…", "#1 Laptop · 1 ETH", "#2 Phone", "#3 Tablet · 1 ETH · reserved"]);
  });

  describe("predictions", () => {
    it("warns before sending when the contract would refuse", async () => {
      await mount({ products: [product({ owner: ME })] }); // I own it
      await userEvent.click(radio("Buy now"));
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      expect(status()).toHaveTextContent("CannotBuyOwnProduct");
    });

    it("says it should succeed when it should", async () => {
      await mount();
      await userEvent.click(radio("Buy now"));
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      expect(status()).toHaveTextContent("This should succeed");
    });

    it("explains an empty name and a wrong payment", async () => {
      await mount();
      expect(status()).toHaveTextContent("EmptyName");
      await userEvent.click(radio("Buy now"));
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      await userEvent.type(screen.getByLabelText(/Payment/), "0.5");
      expect(status()).toHaveTextContent("IncorrectPayment");
    });

    it("pre-fills the payment hint with the listed price", async () => {
      await mount();
      await userEvent.click(radio("Buy now"));
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      expect(screen.getByLabelText(/Payment/)).toHaveAttribute("placeholder", "1");
    });

    it("reports input it cannot use", async () => {
      await mount();
      await userEvent.click(radio("List for sale"));
      expect(status()).toHaveTextContent("Choose a product");
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      await userEvent.type(screen.getByLabelText("Price (ETH)"), "lots");
      expect(status()).toHaveTextContent("not a valid amount");
    });
  });

  describe("sending", () => {
    it("is disabled until someone is acting and the form is usable", async () => {
      await mount({ connected: false });
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
      await act(async () => useWallet.setState({ wallet: { kind: "demo", address: ME, signer: {} as never, chainId: 31337 }, mode: "demo" }));
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    });

    it("simulates, then sends, and moves the dock to the pipeline", async () => {
      const { market, flow } = await mount();
      useUi.getState().setDockTab("activity");
      await userEvent.type(screen.getByLabelText("Name"), "Phone");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(market.send).toHaveBeenCalled());
      expect(market.simulate).toHaveBeenCalledWith("registerProduct", ["Phone"], { value: undefined });
      expect(flow.state.items[0]!.stage).toBe("pending");
      expect(useUi.getState().dockTab).toBe("pipeline");
    });

    it("'Just simulate' stops before sending and offers to send it", async () => {
      const { market, flow } = await mount();
      await userEvent.type(screen.getByLabelText("Name"), "Phone");
      await userEvent.click(screen.getByRole("button", { name: "Just simulate" }));
      expect(await screen.findByText(/would succeed/)).toBeInTheDocument();
      expect(market.send).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Send it now" }));
      await waitFor(() => expect(market.send).toHaveBeenCalled());
      expect(flow.state.items).toHaveLength(1);
    });

    it("explains a failing simulation and offers 'Fix it' and 'Send anyway'", async () => {
      const error = { kind: "custom", name: "NotListed", title: "Not for sale", explanation: "Product #2 is not listed.", fix: "Ask the owner to list it first.", args: {}, reverts: true };
      const { market, flow } = await mount({ sim: { ok: false, error } });
      await userEvent.type(screen.getByLabelText("Name"), "x");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("This would fail: Not for sale");
      expect(alert).toHaveTextContent("Product #2 is not listed.");
      expect(alert).toHaveTextContent("Ask the owner to list it first.");
      expect(market.send).not.toHaveBeenCalled();

      await userEvent.click(within(alert).getByRole("button", { name: "Send anyway" }));
      await waitFor(() => expect(market.send).toHaveBeenCalledWith("registerProduct", ["x"], { value: undefined, force: true }));
      expect(flow.state.items[0]!.forced).toBe(true);
    });

    it("'Fix it' discards the failing draft", async () => {
      const error = { kind: "custom", name: "X", title: "T", explanation: "e", fix: "f", args: {}, reverts: true };
      const { flow } = await mount({ sim: { ok: false, error } });
      await userEvent.type(screen.getByLabelText("Name"), "x");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await userEvent.click(await screen.findByRole("button", { name: "Fix it" }));
      expect(flow.state.items).toHaveLength(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("explains a declined signature", async () => {
      await mount({ sendError: Object.assign(new Error("denied"), { code: "ACTION_REJECTED" }) });
      await userEvent.type(screen.getByLabelText("Name"), "x");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Signature rejected");
    });

    it("submitting the form with Enter sends", async () => {
      const { market } = await mount();
      await userEvent.type(screen.getByLabelText("Name"), "Phone{Enter}");
      await waitFor(() => expect(market.send).toHaveBeenCalled());
    });

    it("keeps the chosen product when switching action", async () => {
      await mount();
      await userEvent.click(radio("List for sale"));
      await userEvent.selectOptions(screen.getByLabelText("Product"), "1");
      await userEvent.click(radio("Cancel listing"));
      expect(screen.getByLabelText("Product")).toHaveValue("1");
    });
  });

  it("exposes the flow to other components", async () => {
    const { flow } = await mount();
    expect(getTxFlow()).toBe(flow);
  });
});
