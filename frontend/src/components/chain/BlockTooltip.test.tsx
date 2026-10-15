import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiRecordDetail, ApiTx } from "@dpp/shared";
import { ApiError } from "@/api/client";
import { AppProviders } from "@/providers";
import { verifyInBrowser } from "@/lib/verifyInBrowser";
import { validChain, startFakeController, ROLES, H, msg } from "@/test/fakes";
import { Tooltip } from "@/components/common/Tooltip";
import { BlockTooltip } from "./BlockTooltip";

const tx = (over: Partial<ApiTx> = {}): ApiTx => ({
  hash: H(500), from: ROLES[0]!.address, to: ROLES[0]!.address, nonce: 3, value: "0", functionName: "registerProduct", args: { name: "Laptop" },
  status: 1, state: "mined", blockNumber: 7, txIndex: 0, gasUsed: "267596", gasLimit: "300000", maxFee: "3", maxPriorityFee: "1",
  effectiveGasPrice: "2", firstSeenAt: 1000, minedAt: 1042, replacedBy: null, revert: null, recordIndex: "0", ...over,
});

async function show(over: { records?: ReturnType<typeof validChain>; detail?: () => Promise<ApiRecordDetail> } = {}) {
  const records = over.records ?? validChain(2);
  const started = await startFakeController({
    record: vi.fn(over.detail ?? (async (i: string) => ({ ...records[Number(i)]!, hashSteps: { fields: [], encoded: "0x", hash: records[Number(i)]!.hash }, tx: tx() }))),
  });
  const check = verifyInBrowser(records).checks[0];
  render(
    <AppProviders controller={started.controller}>
      <Tooltip content={<BlockTooltip record={records[0]!} check={check} />} delay={0}><button>block</button></Tooltip>
    </AppProviders>,
  );
  await userEvent.tab();
  return { ...started, tip: await screen.findByRole("tooltip") };
}

describe("BlockTooltip", () => {
  it("shows the record, the creating transaction and each integrity check", async () => {
    const { tip } = await show();
    expect(within(tip).getByText("Record")).toBeInTheDocument();
    expect(within(tip).getByText("Registered")).toBeInTheDocument();
    expect(within(tip).getByText("Manufacturer")).toBeInTheDocument();
    expect(tip).toHaveTextContent("Laptop #1");

    await waitFor(() => expect(within(tip).getByText("registerProduct(Laptop)")).toBeInTheDocument());
    expect(within(tip).getByText("7")).toBeInTheDocument();           // block number
    expect(within(tip).getByText("267,596")).toBeInTheDocument();      // gas used
    expect(within(tip).getByText("42 ms")).toBeInTheDocument();        // pending → mined

    expect(within(tip).getByText(/Intact/)).toBeInTheDocument();
    expect(within(tip).getAllByLabelText("passed")).toHaveLength(3);
  });

  it("explains each way a check can fail", async () => {
    const records = validChain(2);
    records[0] = { ...records[0]!, price: "5" };
    const { tip } = await show({ records });
    expect(within(tip).getByText(/Data tampered/)).toBeInTheDocument();
    expect(within(tip).getByLabelText("failed")).toBeInTheDocument();
    expect(within(tip).getByText(/does not match the stored hash/)).toBeInTheDocument();
  });

  it("says the transaction is loading, then shows an error without breaking the rest", async () => {
    let reject!: (e: unknown) => void;
    const { tip } = await show({ detail: () => new Promise((_, r) => { reject = r; }) });
    expect(within(tip).getByText("Loading…")).toBeInTheDocument();
    await act(async () => reject(new ApiError(500, "internal", "Internal error")));
    await waitFor(() => expect(within(tip).getByText(/Could not load: Internal error/)).toBeInTheDocument());
    expect(within(tip).getByText("Record")).toBeInTheDocument();
  });

  it("shows a failed transaction's status", async () => {
    const records = validChain(1);
    const { tip } = await show({ records, detail: async () => ({ ...records[0]!, hashSteps: { fields: [], encoded: "0x", hash: records[0]!.hash }, tx: tx({ state: "failed", status: 0 }) }) });
    await waitFor(() => expect(within(tip).getByText("Failed")).toBeInTheDocument());
  });

  it("caches the detail across hovers and drops the cache when history changes", async () => {
    const { controller, api } = await show();
    await waitFor(() => expect(api.record).toHaveBeenCalledTimes(1));
    await controller.recordDetail("0");
    await controller.recordDetail("0");
    expect(api.record).toHaveBeenCalledTimes(1);

    controller.apply(msg("lab.tampered", {}));
    await controller.recordDetail("0");
    expect(api.record).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed lookup", async () => {
    const { controller, api } = await startFakeController({ record: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ ok: true }) });
    await expect(controller.recordDetail("3")).rejects.toThrow("boom");
    await controller.recordDetail("3");
    expect(api.record).toHaveBeenCalledTimes(2);
  });
});
