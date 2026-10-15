import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { useUi } from "@/store/uiStore";
import type { RuleEnv } from "@/web3/ruleRunner";
import { RULES } from "@/web3/rules";
import { startFakeController } from "@/test/fakes";
import { BreakRules } from "./BreakRules";

vi.mock("@/web3/ruleRunner", async (orig) => {
  const real = await orig<typeof import("@/web3/ruleRunner")>();
  return { ...real, runRule: vi.fn() };
});
import * as runner from "@/web3/ruleRunner";

const env = (over: Partial<RuleEnv> = {}): RuleEnv => ({
  marketAddress: "0xmarket", productCount: 3, automine: true, signerFor: vi.fn(), actAs: vi.fn(), increaseTime: vi.fn(), flow: {} as never, ...over,
});

async function mount(e: RuleEnv | null | undefined) {
  const started = await startFakeController();
  const flow = new TxFlow({ api: {} as never, market: () => null, who: () => null });
  render(<AppProviders controller={started.controller} flow={flow}><BreakRules env={e} /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  await userEvent.click(screen.getByText("Try to break the rules"));
  return started;
}

beforeEach(() => { vi.mocked(runner.runRule).mockReset(); window.localStorage.clear(); useUi.getState().reset(); });

describe("BreakRules", () => {
  it("lists one rule per error, each with what it teaches and the error name", async () => {
    await mount(env());
    expect(screen.getAllByRole("listitem")).toHaveLength(RULES.length);
    expect(screen.getByText("Buy your own product")).toBeInTheDocument();
    expect(screen.getByText(/Buyer and seller must be different/)).toBeInTheDocument();
    expect(screen.getByText("CannotBuyOwnProduct")).toBeInTheDocument();
  });

  it("offers a 'Try it' button for the 13 runnable rules and none for the two that need the Broken Wallet", async () => {
    await mount(env());
    expect(screen.getAllByRole("button", { name: /^Try it:/ })).toHaveLength(13);
    expect(screen.getByText(/Two rules need the “Broken Wallet”/)).toHaveTextContent("PaymentFailed, WithdrawFailed");
  });

  it("runs the chosen rule, reports progress, and points the user at the pipeline", async () => {
    vi.mocked(runner.runRule).mockImplementation(async (_rule, e) => {
      e.onProgress?.("Manufacturer lists it for 1 ETH");
      return { txId: "tx-1" };
    });
    await mount(env());
    useUi.getState().setDockTab("activity");
    await userEvent.click(screen.getByRole("button", { name: "Try it: Buy your own product" }));

    expect(vi.mocked(runner.runRule).mock.calls[0]![0].error).toBe("CannotBuyOwnProduct");
    const result = await screen.findByRole("status", { name: "Rule result" });
    expect(result).toHaveTextContent("the contract refuses it with CannotBuyOwnProduct");
    expect(useUi.getState().dockTab).toBe("pipeline");
  });

  it("locks every button while one rule is running", async () => {
    let finish!: () => void;
    vi.mocked(runner.runRule).mockImplementation(() => new Promise((r) => { finish = () => r({ txId: "x" }); }));
    await mount(env());
    await userEvent.click(screen.getByRole("button", { name: "Try it: Buy your own product" }));
    for (const b of screen.getAllByRole("button", { name: /^Try it:/ })) expect(b).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try it: Pay the wrong amount" })).toBeEnabled());
  });

  it("shows why a rule could not be run", async () => {
    vi.mocked(runner.runRule).mockRejectedValue(new runner.RuleError("Could not set the situation up: no such account"));
    await mount(env());
    await userEvent.click(screen.getByRole("button", { name: "Try it: Pay the wrong amount" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not set the situation up");
  });

  it("is disabled, with an explanation, until a contract is deployed on a lab-enabled chain", async () => {
    await mount(null);
    expect(screen.getByText(/Available on the local development chain/)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /^Try it:/ })) expect(b).toBeDisabled();
  });

  it("asks for automatic mining when the chain is paused", async () => {
    await mount(env({ automine: false }));
    expect(screen.getByText(/Switch mining to Auto first/)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /^Try it:/ })) expect(b).toBeDisabled();
    expect(screen.getByRole("button", { name: /Every error/ })).toBeDisabled();
  });

  it("runs the 'Every error' scenario for the two Broken Wallet rules", async () => {
    const started = await mount(env());
    started.api.lab.runScenario = vi.fn(async () => ({ name: "everyError", steps: Array.from({ length: 22 }, (_, i) => `s${i}`), result: {} }));
    await userEvent.click(screen.getByRole("button", { name: /Every error/ }));
    expect(started.api.lab.runScenario).toHaveBeenCalledWith("everyError");
    expect(await screen.findByRole("status", { name: "Rule result" })).toHaveTextContent("22 steps");
    expect(useUi.getState().dockTab).toBe("activity");
    expect(within(screen.getByRole("status", { name: "Rule result" })).getByText(/Activity tab/)).toBeInTheDocument();
  });
});
