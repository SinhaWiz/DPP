import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProviders } from "@/providers";
import { useUi } from "@/store/uiStore";
import { startFakeController, validChain } from "@/test/fakes";
import { Playground } from "./Playground";

async function mount(mining: "auto" | "manual" = "auto") {
  const started = await startFakeController();
  started.api.setRecords(validChain(4));
  started.api.lab.status.mockResolvedValue({ mining: { mode: mining, automine: mining === "auto", intervalMs: null }, clients: 1 });
  render(<MemoryRouter><AppProviders controller={started.controller}><Playground /></AppProviders></MemoryRouter>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}
beforeEach(() => { window.localStorage.clear(); useUi.getState().reset(); });

describe("Playground", () => {
  it("explains the three steps and shows the chain", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Playground" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "How to use the playground" })).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Pick who you are");
    expect(within(screen.getByRole("region", { name: "The chain" })).getByRole("group", { name: "Ledger chain" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Record \d:/ })).toHaveLength(4);
  });

  it("suggests Step mode on automatic mining, and confirms it when already in it", async () => {
    await mount("auto");
    expect(screen.getByText(/Try Step mode/)).toBeInTheDocument();
  });

  it("tells a learner in Step mode how to finish the transaction", async () => {
    await mount("manual");
    expect(await screen.findByText(/press Mine block/)).toBeInTheDocument();
  });

  it("switches between the pipeline, the mempool and the activity feed", async () => {
    await mount();
    expect(screen.getByText("No transaction yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Mempool" }));
    expect(screen.getByRole("tab", { name: "Mempool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Nothing is waiting")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
  });
});
