import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { AppProviders } from "@/providers";
import { TamperPage } from "@/pages/TamperLab";
import { msg, session, startFakeController, validChain } from "@/test/fakes";

const attack = (id: string, mode: string, writes: [string, string][]) => ({
  groupId: id, mode, createdAt: 1, writes: writes.map(([recordIndex, field]) => ({ recordIndex, field, slot: "0x1", oldValue: "0x0", newValue: "0x1" })),
});

async function mount(over: Record<string, unknown> = {}, opts: { attacks?: ReturnType<typeof attack>[]; strict?: boolean } = {}) {
  const started = await startFakeController(over);
  started.api.setRecords(validChain(6));
  if (opts.attacks) started.api.lab.attacks.mockResolvedValue({ attacks: opts.attacks });
  const ui = <AppProviders controller={started.controller}><TamperPage /></AppProviders>;
  render(opts.strict ? <StrictMode>{ui}</StrictMode> : ui);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}

describe("Tamper Lab: availability", () => {
  it("explains why it is off outside the local chain", async () => {
    const { api } = await mount({ session: vi.fn(async () => session({ lab: { available: false, reason: "Lab features are disabled on chain 11155111; they only run on the local dev chain (31337)." } })) });
    expect(await screen.findByText("Only available on the local development chain")).toBeInTheDocument();
    expect(screen.getByText(/chain 11155111/)).toBeInTheDocument();
    expect(api.lab.snapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restore everything" })).not.toBeInTheDocument();
  });

  it("asks for a deployment when there is no contract yet", async () => {
    await mount({ session: vi.fn(async () => session({ contracts: null })) });
    expect(await screen.findByText(/Deploy the contract first/)).toBeInTheDocument();
  });
});

describe("Tamper Lab: safety", () => {
  it("warns that storage is being edited directly, and that it only works on a local chain", async () => {
    await mount();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("editing contract storage directly");
    expect(note).toHaveTextContent("nobody can rewrite stored data like this");
  });

  it("takes a safety snapshot when the lab opens, only once even if the page renders twice", async () => {
    const { api } = await mount({}, { strict: true });
    await waitFor(() => expect(api.lab.snapshot).toHaveBeenCalled());
    expect(api.lab.snapshot).toHaveBeenCalledTimes(1);
    expect(api.lab.snapshot).toHaveBeenCalledWith("lab-entry");
    expect(await screen.findByRole("button", { name: "Restore everything" })).toBeEnabled();
  });

  it("cannot restore until the snapshot exists, and reports if it could not be taken", async () => {
    const started = await startFakeController();
    started.api.lab.snapshot.mockRejectedValue(new ApiError(500, "internal", "node busy"));
    render(<AppProviders controller={started.controller}><TamperPage /></AppProviders>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not take the safety snapshot: node busy");
    expect(screen.getByRole("button", { name: "Restore everything" })).toBeDisabled();
  });

  it("restores everything to the entry snapshot", async () => {
    const { api } = await mount();
    const btn = await screen.findByRole("button", { name: "Restore everything" });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(api.lab.restore).toHaveBeenCalledWith("lab-entry");
    expect(await screen.findByText(/back to how it was when you opened the lab/)).toBeInTheDocument();
  });

  it("undoes the latest attack, or all of them", async () => {
    const { api } = await mount({}, { attacks: [attack("g-1", "data", [["2", "price"]]), attack("g-2", "data+hash", [["3", "price"], ["3", "hash"]])] });
    await screen.findByText("#2 data+hash");
    await userEvent.click(screen.getByRole("button", { name: "Undo last attack" }));
    expect(api.lab.undo).toHaveBeenCalledWith("g-2");
    await userEvent.click(screen.getByRole("button", { name: "Undo all" }));
    expect(api.lab.undoAll).toHaveBeenCalled();
  });

  it("has nothing to undo when there are no attacks", async () => {
    await mount();
    expect(await screen.findByText(/stored data is exactly what the contract wrote/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last attack" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo all" })).toBeDisabled();
  });

  it("shows why an undo failed", async () => {
    const { api } = await mount({}, { attacks: [attack("g-1", "data", [["2", "price"]])] });
    api.lab.undo.mockRejectedValue(new ApiError(409, "undo_later_first", "A later attack changed the same data. Undo the later attack first."));
    await userEvent.click(await screen.findByRole("button", { name: "Undo last attack" }));
    expect(await screen.findByText(/Undo the later attack first/)).toBeInTheDocument();
  });
});

describe("Tamper Lab: journal and chain", () => {
  it("lists active attacks with the records and fields they changed", async () => {
    await mount({}, { attacks: [attack("g-1", "rewrite-tail", [["2", "price"], ["2", "hash"], ["3", "prevHash"]])] });
    const journal = await screen.findByRole("region", { name: "Active attacks" });
    expect(journal).toHaveTextContent("rewrite-tail");
    expect(journal).toHaveTextContent("3 writes");
    expect(journal).toHaveTextContent("#2.price, #2.hash, #3.prevHash");
  });

  it("reloads the journal when the lab reports a change", async () => {
    const { api, controller } = await mount();
    await screen.findByRole("region", { name: "Active attacks" });
    api.lab.attacks.mockClear();
    act(() => controller.apply(msg("lab.tampered", {})));
    await waitFor(() => expect(api.lab.attacks).toHaveBeenCalled());
  });

  it("shows the chain and counts the records that no longer verify, from the browser's own check", async () => {
    const records = validChain(6);
    records[3] = { ...records[3]!, price: "5" };
    const started = await startFakeController();
    started.api.setRecords(records);
    render(<AppProviders controller={started.controller}><TamperPage /></AppProviders>);
    await waitFor(() => expect(started.controller.state.loaded).toBe(true));
    expect(await screen.findByText(/1 record no longer verify/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Ledger chain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Record 3:.*Data tampered/ })).toBeInTheDocument();
  });

  it("says every record verifies on an untouched chain", async () => {
    await mount();
    expect(await screen.findByText(/Every record verifies/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Ledger chain" })).getAllByRole("button")).not.toHaveLength(0);
  });
});
