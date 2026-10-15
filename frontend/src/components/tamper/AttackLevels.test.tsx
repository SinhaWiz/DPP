import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { computeHash, type ApiRecord } from "@dpp/shared";
import { ApiError } from "@/api/client";
import { AppProviders } from "@/providers";
import { apiToLedgerRecord } from "@/lib/verifyInBrowser";
import { startFakeController, tamperResult, validChain, verifyOk } from "@/test/fakes";
import { AttackLevels } from "./AttackLevels";

const contract = (valid: boolean, brokenAt: string, brokenIndexes: string[]) =>
  ({ ...verifyOk, onChain: { valid, brokenAt, audit: { brokenIndexes, reasons: brokenIndexes.map(() => 1) } } });

async function mount(records: ApiRecord[] = validChain(6), verify: object = contract(true, "0", [])) {
  const started = await startFakeController({ verify: vi.fn(async () => verify) });
  started.api.setRecords(records);
  const onChanged = vi.fn();
  render(<AppProviders controller={started.controller}><AttackLevels onChanged={onChanged} /></AppProviders>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return { ...started, onChanged };
}

const tab = (n: number) => screen.getByRole("tab", { name: new RegExp(`^Level ${n}`) });
const index = () => screen.getByLabelText("Record to attack") as HTMLInputElement;

describe("AttackLevels", () => {
  it("offers four levels, starting with 'Edit the data', and explains each attack", async () => {
    await mount();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab(1)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Change one field of one stored record");
    await userEvent.click(tab(3));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("recomputes every hash and link");
  });

  it("asks the learner to predict, with the record number filled in, before anything is run", async () => {
    await mount();
    await userEvent.clear(index());
    await userEvent.type(index(), "2");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Before you run it, predict: Record #2's hash will no longer match");
    await userEvent.click(tab(2));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("link 2→3 breaks");
  });

  it("starts from a record in the middle of the chain and keeps the choice inside it", async () => {
    await mount();
    expect(index().value).toBe("2");
    await userEvent.clear(index());
    await userEvent.type(index(), "99");
    expect(index().value).toBe("5");   // the last record
  });

  it("level 1: sends a data-only edit and shows the three verdicts and the lesson", async () => {
    const tampered = validChain(6);
    tampered[2] = { ...tampered[2]!, price: "999" };
    const { api, onChanged } = await mount(tampered, contract(false, "2", ["2"]));
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));

    expect(api.lab.tamper).toHaveBeenCalledWith({ index: 2, field: "price", value: "999", mode: "data" });
    const verdicts = await screen.findByLabelText("Verdicts");
    const rows = within(verdicts).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("verifyLedger()");
    expect(rows[0]).toHaveTextContent("first problem at record #2");
    expect(rows[1]).toHaveTextContent("broken: #2");
    expect(rows[2]).toHaveTextContent("Your browser");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("A hash is a fingerprint");
    expect(onChanged).toHaveBeenCalled();
  });

  it("level 2: sends data+hash and explains the broken link", async () => {
    const { api } = await mount();
    await userEvent.click(tab(2));
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    expect(api.lab.tamper).toHaveBeenCalledWith(expect.objectContaining({ mode: "data+hash" }));
    expect(await screen.findByText(/Each record locks in the one before it/)).toBeInTheDocument();
  });

  it("level 3: shows that the contract is fooled while the browser is not", async () => {
    const forged = validChain(6).map(apiToLedgerRecord);
    forged[2]!.price = 99n;
    const records = validChain(6);
    for (let i = 2; i < forged.length; i++) {
      if (i > 2) forged[i]!.prevHash = forged[i - 1]!.hash;
      forged[i]!.hash = computeHash(forged[i]!);
      records[i] = { ...records[i]!, price: forged[i]!.price.toString(), prevHash: forged[i]!.prevHash, hash: forged[i]!.hash };
    }
    const { api } = await mount(records, contract(true, "0", []));
    await userEvent.click(tab(3));
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    expect(api.lab.tamper).toHaveBeenCalledWith(expect.objectContaining({ mode: "rewrite-tail" }));

    const verdicts = await screen.findByLabelText("Verdicts");
    expect(within(verdicts).getAllByRole("row")[1]).toHaveTextContent("✔ intact");   // the contract is fooled
    expect(within(verdicts).getAllByRole("row")[3]).toHaveTextContent("✘ problem");  // the browser is not
    expect(verdicts).toHaveTextContent("The contract says the ledger is valid");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("consistency, not authenticity");
  });

  it("level 4: attacks two records and explains why verifyLedger names only one", async () => {
    const records = validChain(6);
    records[2] = { ...records[2]!, price: "9" };
    records[4] = { ...records[4]!, price: "9" };
    const { api } = await mount(records, contract(false, "2", ["2", "4"]));
    await userEvent.click(tab(4));
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    expect(api.lab.tamper).toHaveBeenNthCalledWith(1, expect.objectContaining({ index: 2, mode: "data" }));
    expect(api.lab.tamper).toHaveBeenNthCalledWith(2, expect.objectContaining({ index: 4, mode: "data" }));
    expect(await screen.findByText(/stops at the first problem \(record #2\)/)).toBeInTheDocument();
  });

  it("level 4 needs room for a second record", async () => {
    await mount(validChain(2));
    await userEvent.click(tab(4));
    expect(screen.getByText(/needs two records to attack/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the attack" })).toBeDisabled();
  });

  it("lets the learner choose another field and fills in a sensible new value", async () => {
    const { api } = await mount();
    await userEvent.selectOptions(screen.getByLabelText("Field to change"), "action");
    expect((screen.getByLabelText("New value") as HTMLInputElement).value).toBe("2");
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    expect(api.lab.tamper).toHaveBeenCalledWith({ index: 2, field: "action", value: "2", mode: "data" });
  });

  it("hides last run's results when another level is picked", async () => {
    await mount();
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    await screen.findByLabelText("Verdicts");
    await userEvent.click(tab(2));
    expect(screen.queryByLabelText("Verdicts")).not.toBeInTheDocument();
  });

  it("shows why an attack was refused and does not claim a result", async () => {
    const { api } = await mount();
    api.lab.tamper.mockRejectedValue(new ApiError(400, "bad_request", "'abc' is not a valid value for price"));
    await userEvent.click(screen.getByRole("button", { name: "Run the attack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a valid value for price");
    expect(screen.queryByLabelText("Verdicts")).not.toBeInTheDocument();
  });

  it("explains that an empty ledger has nothing to attack", async () => {
    await mount([]);
    expect(screen.getByText(/nothing to attack in an empty ledger/)).toBeInTheDocument();
    expect(act).toBeDefined();
    expect(tamperResult("x", "data").groupId).toBe("x");
  });
});
