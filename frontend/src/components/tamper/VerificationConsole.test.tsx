import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiRecord } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { startFakeController, validChain, verifyOk } from "@/test/fakes";
import { VerificationConsole } from "./VerificationConsole";

const onChain = (valid: boolean, brokenAt: string, idx: string[], reasons: number[] = idx.map(() => 1)) => ({ ...verifyOk, onChain: { valid, brokenAt, audit: { brokenIndexes: idx, reasons } } });

async function mount(records: ApiRecord[] = validChain(8), verify: object = onChain(true, "0", [])) {
  const started = await startFakeController({ verify: vi.fn(async () => verify) });
  started.api.setRecords(records);
  render(<AppProviders controller={started.controller}><VerificationConsole /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}
const result = () => screen.getByLabelText("Console result");
const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

describe("VerificationConsole: whole ledger", () => {
  it("verifyLedger() on an intact chain", async () => {
    await mount();
    await click("verifyLedger()");
    expect(await screen.findByText(/the contract says the ledger is intact/)).toBeInTheDocument();
  });

  it("verifyLedger() names only the first broken record and says it stops there", async () => {
    await mount(validChain(8), onChain(false, "3", ["3", "6"]));
    await click("verifyLedger()");
    expect(await screen.findByText(/the first broken record is #3/)).toBeInTheDocument();
    expect(result()).toHaveTextContent("stops at the first problem");
  });

  it("auditRange lists every broken record with the reason", async () => {
    await mount(validChain(8), onChain(false, "3", ["3", "6", "7"], [1, 2, 3]));
    await click(/^auditRange\(0, 8\)/);
    await screen.findByText(/3 broken records/);
    const items = within(result()).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "#3: data does not match its hash",
      "#6: link does not match the previous hash",
      "#7: data does not match its hash and link does not match the previous hash",
    ]);
  });

  it("auditRange on an intact chain finds nothing", async () => {
    await mount();
    await click(/^auditRange/);
    expect(await screen.findByText(/no broken records/)).toBeInTheDocument();
  });

  it("the browser audit confirms an intact chain", async () => {
    await mount();
    await click("Full audit in your browser");
    expect(result()).toHaveTextContent("all 8 records are intact");
  });

  it("the browser audit lists each problem with the reason it found", async () => {
    const bad = validChain(8);
    bad[4] = { ...bad[4]!, price: "7" };
    await mount(bad);
    await click("Full audit in your browser");
    expect(result()).toHaveTextContent("1 problem");
    expect(result()).toHaveTextContent("#4: The hash recomputed from this record's fields does not match");
  });

  it("'Compare all three' shows the verdict table", async () => {
    await mount(validChain(8), onChain(false, "3", ["3"]));
    await click("Compare all three");
    const table = await screen.findByLabelText("Verdicts");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("shows why a call failed", async () => {
    const started = await mount();
    started.api.verify.mockRejectedValue(new Error("node unreachable"));
    await click("verifyLedger()");
    expect(await screen.findByRole("alert")).toHaveTextContent("node unreachable");
  });
});

describe("VerificationConsole: verifyRange", () => {
  const range = (over: object = {}) => ({
    from: 0, to: 8,
    contract: { valid: true, brokenAt: "0", audit: { brokenIndexes: [] as string[], reasons: [] as number[] } },
    offChain: { valid: true, brokenIndexes: [] as string[], contractVisibleIndexes: [] as string[] },
    ...over,
  });

  it("defaults to the whole ledger and asks the contract about it", async () => {
    const { api } = await mount();
    expect(screen.getByRole("button", { name: "verifyRange(0, 8)" })).toBeInTheDocument();
    await click("verifyRange(0, 8)");
    expect(api.verifyRange).toHaveBeenCalledWith(0, 8);
  });

  it("follows the sliders", async () => {
    const { api } = await mount();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "5" } });
    await click("verifyRange(2, 5)");
    expect(api.verifyRange).toHaveBeenCalledWith(2, 5);
  });

  it("never lets the start pass the end", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "6" } });
    expect(screen.getByRole("button", { name: "verifyRange(3, 3)" })).toBeInTheDocument();
  });

  it("a click on the minimap selects a short range starting there", async () => {
    await mount();
    const cells = screen.getByRole("img", { name: /Overview of 8 records/ }).querySelectorAll("button");
    await userEvent.click(cells[2]!);
    expect(screen.getByRole("button", { name: "verifyRange(2, 5)" })).toBeInTheDocument();
  });

  it("reports an intact range for both the contract and the browser", async () => {
    const { api } = await mount();
    api.verifyRange.mockResolvedValue(range({ from: 2, to: 5 }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "5" } });
    await click("verifyRange(2, 5)");
    await waitFor(() => expect(result()).toHaveTextContent("verifyRange(2, 5) →"));
    expect(result()).toHaveTextContent("intact");
    expect(result()).toHaveTextContent("only looks at the records inside it");
  });

  it("explains a problem the contract's range check cannot see", async () => {
    const { api } = await mount();
    api.verifyRange.mockResolvedValue(range({
      contract: { valid: true, brokenAt: "0", audit: { brokenIndexes: [], reasons: [] } },
      offChain: { valid: false, brokenIndexes: ["3", "4"], contractVisibleIndexes: [] },
    }));
    await click("verifyRange(0, 8)");
    expect(await screen.findByText(/cannot see #3, #4/)).toBeInTheDocument();
  });

  it("says an empty range is always valid", async () => {
    const { api } = await mount();
    api.verifyRange.mockResolvedValue(range({ from: 0, to: 0 }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "0" } });
    await click("verifyRange(0, 0)");
    expect(await screen.findByText(/empty range has nothing to check/)).toBeInTheDocument();
  });

  it("shows the contract's refusal of a bad range", async () => {
    const { api } = await mount();
    api.verifyRange.mockRejectedValue(new Error("Invalid range [3, 2)"));
    await click("verifyRange(0, 8)");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid range");
  });

  it("disables range checks on an empty ledger", async () => {
    await mount([]);
    expect(screen.getByRole("button", { name: "verifyRange(0, 0)" })).toBeDisabled();
  });
});
