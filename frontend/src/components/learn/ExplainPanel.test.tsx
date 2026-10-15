import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProviders } from "@/providers";
import { useNarration } from "@/store/narration";
import { useUi } from "@/store/uiStore";
import { H, msg, startFakeController } from "@/test/fakes";
import { ExplainPanel } from "./ExplainPanel";

async function mount(txs: unknown[] = []) {
  const started = await startFakeController({ txs: async () => ({ total: txs.length, txs }) });
  render(
    <MemoryRouter>
      <AppProviders controller={started.controller}><ExplainPanel /></AppProviders>
    </MemoryRouter>,
  );
  await act(async () => { await started.controller.refetchAll(); });
  return started;
}
const say = (c: { apply: (m: ReturnType<typeof msg>) => void }, type: Parameters<typeof msg>[0], data: unknown = {}, seq = 1) => act(() => c.apply(msg(type, data, seq)));

beforeEach(() => { window.localStorage.clear(); useUi.getState().reset(); useNarration.getState().clear(); });

describe("ExplainPanel", () => {
  it("invites the user to act, and says how underlined words and Detailed mode work", async () => {
    await mount();
    expect(screen.getByText("Waiting for activity")).toBeInTheDocument();
    expect(screen.getByText(/Underlined words are explained/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("narrates events as they arrive, newest first", async () => {
    const { controller } = await mount();
    await say(controller, "tx.pending", { functionName: "buy", args: { productId: "1" } }, 1);
    await say(controller, "record.appended", { index: "4" }, 2);
    const cards = within(screen.getByLabelText("Explanations")).getAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Ledger record #4 added", "Waiting in the mempool"]);
    expect(cards[0]).toHaveTextContent("hash of record #3");
  });

  it("underlines glossary words inside the explanation", async () => {
    const { controller } = await mount();
    await say(controller, "tx.pending", { functionName: "buy" });
    const card = screen.getByRole("article", { name: "Waiting in the mempool" });
    expect(within(card).getByLabelText(/^mempool:/)).toBeInTheDocument();
    expect(within(card).getByLabelText(/^nonce:/)).toBeInTheDocument();
  });

  it("keeps the extra depth for Detailed mode, and remembers the choice", async () => {
    const { controller } = await mount();
    await say(controller, "record.appended", { index: "4" });
    expect(screen.queryByText(/independent witness/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "detailed" }));
    expect(screen.getByRole("radio", { name: "detailed" })).toBeChecked();
    expect(screen.getByText(/independent witness/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("ledger-lab.ui.v1")!).explainMode).toBe("detailed");

    await userEvent.click(screen.getByRole("radio", { name: "beginner" }));
    expect(screen.queryByText(/independent witness/)).not.toBeInTheDocument();
  });

  it("shows the contract code behind a refusal in Detailed mode, using the transaction's reason", async () => {
    const tx = { hash: H(5), revert: { name: "NotListed", title: "Not for sale", explanation: "Product #1 is not listed.", fix: "List it first.", args: {}, data: "0x", approximate: false } };
    const { controller } = await mount([tx]);
    await say(controller, "tx.failed", { hash: H(5) });
    const card = screen.getByRole("article", { name: "Refused: Not for sale" });
    expect(card).toHaveTextContent("Product #1 is not listed.");
    expect(within(card).queryByText(/revert NotListed/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "detailed" }));
    expect(within(card).getByText(/revert NotListed\(product\.id\)/)).toBeInTheDocument();
    expect(card).toHaveTextContent("In the contract: _requirePurchasable");
    expect(card).toHaveTextContent("How to fix it: List it first.");
  });

  it("links to the lesson that goes deeper", async () => {
    const { controller } = await mount();
    await say(controller, "verification.changed", { valid: false, firstBrokenAt: "2" });
    const link = screen.getByRole("link", { name: /Learn more: Breaking the chain/ });
    expect(link).toHaveAttribute("href", "/learn?lesson=breaking-the-chain");
  });

  it("never shows the same message twice, ignores chatter, and can be cleared", async () => {
    const { controller } = await mount();
    await say(controller, "block.new", { number: 3, txCount: 1 }, 7);
    await say(controller, "block.new", { number: 3, txCount: 1 }, 7);
    await say(controller, "indexer.status", {}, 8);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for activity")).toBeInTheDocument();
  });

  it("keeps only the most recent explanations", async () => {
    const { controller } = await mount();
    for (let i = 1; i <= 60; i++) await say(controller, "block.new", { number: i, txCount: 1 }, i);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(40);
    expect(cards[0]).toHaveAccessibleName("Ethereum block 60 mined");
  });
});
