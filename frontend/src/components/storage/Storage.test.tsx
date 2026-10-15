import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers";
import { StoragePage } from "@/pages/Storage";
import { msg, startFakeController, storageRecordFixture, validChain } from "@/test/fakes";
import { PackedSlotBar } from "./SlotView";

async function mount(path = "/storage?record=2", over: { records?: number; mismatchSlot?: number } = {}) {
  const started = await startFakeController({
    storageRecord: vi.fn(async (i: string) => storageRecordFixture(i, { mismatchSlot: over.mismatchSlot })),
  });
  started.api.setRecords(validChain(over.records ?? 5));
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders controller={started.controller}><StoragePage /></AppProviders>
    </MemoryRouter>,
  );
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}

describe("PackedSlotBar", () => {
  it("splits a packed slot into unused bytes, the 20-byte actor and the 1-byte action", () => {
    const actor = "f39fd6e51aad88f6f4ce6ab8827279cfffb92266";
    render(<PackedSlotBar value={"0x" + "00".repeat(11) + actor + "03"} />);
    const bar = screen.getByLabelText("How this slot is packed");
    expect(within(bar).getByText("unused · 11B")).toBeInTheDocument();
    expect(within(bar).getByText("actor · 20B")).toBeInTheDocument();
    expect(within(bar).getByText("action · 1B")).toBeInTheDocument();
    expect(bar).toHaveTextContent(actor);
    expect(bar.lastElementChild).toHaveTextContent("03");
  });
});

describe("StoragePage: slots", () => {
  it("shows the eight slots of the chosen record, in order, with the fields each one holds", async () => {
    const { api } = await mount();
    await screen.findByRole("region", { name: "Storage slots" });
    expect(api.storageRecord).toHaveBeenCalledWith("2");
    const slots = within(screen.getByRole("region", { name: "Storage slots" })).getAllByRole("listitem");
    expect(slots).toHaveLength(8);
    expect(slots[0]).toHaveTextContent("slot +0");
    expect(slots[0]).toHaveTextContent("index (32 bytes)");
    expect(slots[7]).toHaveTextContent("hash");
  });

  it("shows the packed slot as two fields sharing one slot, with its byte layout", async () => {
    await mount();
    const packed = (await screen.findAllByRole("listitem")).find((li) => li.getAttribute("aria-label")?.startsWith("Slot 3"))!;
    expect(packed).toHaveTextContent("action (1 byte) + actor (20 bytes)");
    expect(within(packed).getByLabelText("How this slot is packed")).toBeInTheDocument();
  });

  it("confirms when everything matches", async () => {
    await mount();
    expect(await screen.findByText(/All eight slots hold exactly what the layout predicts/)).toBeInTheDocument();
  });

  it("points at the slot that differs and says what that means", async () => {
    await mount("/storage?record=2", { mismatchSlot: 5 });
    const status = await screen.findByText(/1 slot differ/);
    expect(status).toHaveTextContent("direct edit of contract storage");
    const bad = screen.getByRole("listitem", { name: "Slot 5, differs" });
    expect(bad).toHaveTextContent("The node holds");
    expect(bad).toHaveClass("border-tampered");
    expect(screen.getByRole("listitem", { name: "Slot 4" })).not.toHaveClass("border-tampered");
  });

  it("explains where the slot numbers come from, using this record's numbers", async () => {
    await mount();
    const maths = (await screen.findByText("Where do these slot numbers come from?")).closest("details")!;
    expect(maths).toHaveTextContent("slot 0");
    expect(maths).toHaveTextContent("keccak256(0)");
    expect(maths).toHaveTextContent("8 × 2");
    expect(maths).toHaveTextContent("9 fields in 8 slots");
  });

  it("reloads when history changes underneath it", async () => {
    const { api, controller } = await mount();
    await screen.findByRole("region", { name: "Storage slots" });
    api.storageRecord.mockClear();
    act(() => controller.apply(msg("lab.tampered", {})));
    await waitFor(() => expect(api.storageRecord).toHaveBeenCalledTimes(1));
    act(() => controller.apply(msg("block.new", {})));  // ordinary traffic does not
    expect(api.storageRecord).toHaveBeenCalledTimes(1);
  });
});

describe("StoragePage: choosing a record", () => {
  it("asks the user to pick one when none is chosen, and lists the records", async () => {
    await mount("/storage");
    expect(await screen.findByText("Select a record to inspect its slots")).toBeInTheDocument();
    expect(within(screen.getByRole("combobox")).getAllByRole("option")).toHaveLength(1 + 5);
  });

  it("loads a record when it is picked", async () => {
    const { api } = await mount("/storage");
    await userEvent.selectOptions(screen.getByRole("combobox"), "3");
    await screen.findByRole("region", { name: "Storage slots" });
    expect(api.storageRecord).toHaveBeenCalledWith("3");
  });

  it("ignores a record number that does not exist", async () => {
    const { api } = await mount("/storage?record=99");
    expect(await screen.findByText("Select a record to inspect its slots")).toBeInTheDocument();
    expect(api.storageRecord).not.toHaveBeenCalled();
  });

  it("explains an empty ledger", async () => {
    await mount("/storage", { records: 0 });
    expect(await screen.findByText("The ledger is empty")).toBeInTheDocument();
  });

  it("shows a failure to read storage", async () => {
    const started = await startFakeController({ storageRecord: vi.fn().mockRejectedValue(new Error("Record #2 not found")) });
    started.api.setRecords(validChain(5));
    render(<MemoryRouter initialEntries={["/storage?record=2"]}><AppProviders controller={started.controller}><StoragePage /></AppProviders></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Record #2 not found");
  });
});
