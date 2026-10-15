import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeHash, type ApiRecord } from "@dpp/shared";
import { AppProviders } from "@/providers";
import { verifyInBrowser, apiToLedgerRecord } from "@/lib/verifyInBrowser";
import { useSelection } from "@/store/selection";
import { startFakeController, validChain } from "@/test/fakes";
import { HashWalkthrough } from "./HashWalkthrough";
import { RecordDetail } from "./RecordDetail";

beforeEach(() => useSelection.setState({ selected: null, productFilter: null }));

async function detail(records: ApiRecord[], index = 1, onClose = vi.fn()) {
  const { controller } = await startFakeController();
  controller.start();
  await waitFor(() => expect(controller.state.loaded).toBe(true)); // role names arrive with the session
  const checks = verifyInBrowser(records).checks;
  render(
    <AppProviders controller={controller}>
      <RecordDetail record={records[index]!} previous={records[index - 1] ?? null} check={checks[index]} onClose={onClose} />
    </AppProviders>,
  );
  return { onClose };
}

describe("HashWalkthrough", () => {
  const records = validChain(3);

  it("walks through the five steps, one at a time", async () => {
    render(<HashWalkthrough record={records[1]!} />);
    const section = screen.getByRole("region", { name: "How is this hash made?" });
    expect(within(section).getByText("1. The fields")).toBeInTheDocument();
    expect(within(section).getAllByRole("row")).toHaveLength(1 + 8); // header + eight fields
    expect(within(section).getByRole("button", { name: "Back" })).toBeDisabled();

    await userEvent.click(within(section).getByRole("button", { name: "Next" }));
    expect(within(section).getByText("2. Each field becomes 32 bytes")).toBeInTheDocument();
    expect(within(section).getByText("32-byte word")).toBeInTheDocument();

    await userEvent.click(within(section).getByRole("button", { name: "Next" }));
    expect(within(section).getByLabelText("Concatenated encoding")).toBeInTheDocument();
    expect(within(section).getByText("224–255")).toBeInTheDocument();

    await userEvent.click(within(section).getByRole("button", { name: "Next" }));
    expect(within(section).getByText("4. keccak256")).toBeInTheDocument();

    await userEvent.click(within(section).getByRole("button", { name: "Next" }));
    expect(within(section).getByRole("status", { name: "Hash comparison" })).toHaveTextContent("They match");
    expect(within(section).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows the real computed hash, equal to the stored one", async () => {
    render(<HashWalkthrough record={records[1]!} />);
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText(`Computed hash ${computeHash(apiToLedgerRecord(records[1]!))}`)).toBeInTheDocument();
  });

  it("says plainly when the data no longer produces the stored hash", async () => {
    const tampered = { ...records[1]!, price: "42" };
    render(<HashWalkthrough record={tampered} />);
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status", { name: "Hash comparison" })).toHaveTextContent("They differ");
  });
});

describe("RecordDetail", () => {
  it("shows the record's fields and its verdict", async () => {
    await detail(validChain(3));
    const panel = screen.getByRole("region", { name: "Record 1 in detail" });
    expect(within(panel).getByRole("heading", { name: "Record #1" })).toBeInTheDocument();
    expect(within(panel).getByText("Intact")).toBeInTheDocument();
    expect(within(panel).getByText("Manufacturer")).toBeInTheDocument();
    expect(within(panel).getByLabelText("1 ETH, 1,000,000,000,000,000,000 wei")).toBeInTheDocument(); // the price
  });

  it("recomputes the hash on request and confirms data and link", async () => {
    await detail(validChain(3));
    expect(screen.queryByRole("status", { name: "Verification result" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recompute now" }));
    const result = screen.getByRole("status", { name: "Verification result" });
    expect(result).toHaveTextContent("Recomputed hash equals the stored hash");
    expect(result).toHaveTextContent("hash of record #0");
  });

  it("reports a record that no longer matches its hash, or no longer links to the one before", async () => {
    const records = validChain(3);
    records[1] = { ...records[1]!, price: "5", prevHash: "0x" + "ee".repeat(32) };
    await detail(records);
    await userEvent.click(screen.getByRole("button", { name: "Recompute now" }));
    const result = screen.getByRole("status", { name: "Verification result" });
    expect(result).toHaveTextContent("differs from the stored hash");
    expect(result).toHaveTextContent("does not equal the hash of record #0");
  });

  it("checks the first record against the genesis hash", async () => {
    await detail(validChain(2), 0);
    await userEvent.click(screen.getByRole("button", { name: "Recompute now" }));
    expect(screen.getByRole("status", { name: "Verification result" })).toHaveTextContent("genesis hash (all zeros)");
  });

  it("follows and unfollows the product", async () => {
    await detail(validChain(3));
    await userEvent.click(screen.getByRole("button", { name: "Follow product #1" }));
    expect(useSelection.getState().productFilter).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Show all products" }));
    expect(useSelection.getState().productFilter).toBeNull();
  });

  it("closes", async () => {
    const { onClose } = await detail(validChain(2));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
