import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiProductTrail } from "@dpp/shared";
import { ProductTimeline, isWithdrawnListing } from "./ProductTimeline";
import { AppProviders } from "@/providers";
import { ROLES, record, startFakeController } from "@/test/fakes";

const eth = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const step = (index: number, action: number, label: string, owner: number, price = "0", note = `note ${index}`) => ({
  record: record(index, { action, actionLabel: label, price }), ownerAfter: ROLES[owner]!.address, note,
});

const trail = (steps: ApiProductTrail["steps"], over: Partial<ApiProductTrail["product"]> = {}): ApiProductTrail => ({
  product: { id: "1", name: "Laptop", owner: ROLES[1]!.address, price: "0", forSale: false, reservation: null, ...over }, steps,
});

async function show(t: ApiProductTrail, selected: bigint | null = null, onSelect = vi.fn()) {
  const { controller } = await startFakeController();
  controller.start();
  render(<AppProviders controller={controller}><ProductTimeline trail={t} selected={selected} onSelect={onSelect} /></AppProviders>);
  await screen.findByText("Distributor", { selector: "span.font-medium" }).catch(() => undefined);
  return { onSelect };
}

describe("isWithdrawnListing", () => {
  const s = (...actions: number[]) => actions.map((a, i) => step(i, a, "x", 0)) as ApiProductTrail["steps"];
  it("is true when the listing was delisted or replaced by another price", () => {
    expect(isWithdrawnListing(s(0, 1, 2), 1)).toBe(true);
    expect(isWithdrawnListing(s(0, 1, 1), 1)).toBe(true);
  });
  it("is false when the listing led to a sale or reservation, or is still standing", () => {
    expect(isWithdrawnListing(s(0, 1, 3), 1)).toBe(false);
    expect(isWithdrawnListing(s(0, 1, 4), 1)).toBe(false);
    expect(isWithdrawnListing(s(0, 1), 1)).toBe(false);
  });
  it("only applies to listings", () => {
    expect(isWithdrawnListing(s(0, 2, 2), 1)).toBe(false);
  });
});

describe("ProductTimeline", () => {
  const story = trail([
    step(0, 0, "Registered", 0, "0", "Manufacturer registered the product and became its owner."),
    step(1, 1, "Listed", 0, eth(2), "Manufacturer listed it for 2 ETH."),
    step(2, 2, "Delisted", 0, "0", "Manufacturer withdrew the listing."),
    step(3, 1, "Listed", 0, eth(3), "Manufacturer listed it for 3 ETH."),
    step(4, 4, "Reserved", 0, eth(3), "Distributor reserved it."),
    step(5, 5, "Revoked", 0, eth(3), "The reservation ended."),
    step(6, 3, "Sold", 1, eth(3), "Manufacturer sold it to Distributor."),
  ]);

  it("tells the story step by step, in order", async () => {
    await show(story);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(screen.getByRole("region", { name: "Timeline of Laptop" })).toBeInTheDocument();
    expect(within(items[0]!).getByText(/registered the product/)).toBeInTheDocument();
    expect(within(items[6]!).getByText(/sold it to Distributor/)).toBeInTheDocument();
  });

  it("strikes through a price that was taken back, but not one that led to a sale", async () => {
    await show(story);
    const prices = screen.getAllByLabelText(/^price/);
    expect(prices.map((p) => p.getAttribute("aria-label"))).toEqual(["price (withdrawn)", "price", "price", "price", "price"]);
    expect(screen.getAllByLabelText("price (withdrawn)")[0]).toHaveClass("line-through");
  });

  it("shows the owner changing only when it does", async () => {
    await show(story);
    const items = screen.getAllByRole("listitem");
    expect(within(items[1]!).queryByText(/changed/)).not.toBeInTheDocument();
    expect(within(items[6]!).getByText(/owner after this step: changed/)).toBeInTheDocument();
  });

  it("selects a record when its step is clicked, and shows which is selected", async () => {
    const { onSelect } = await show(story, 4n);
    const items = screen.getAllByRole("listitem");
    expect(within(items[4]!).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(within(items[3]!).getByRole("button")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(items[5]!).getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(5n);
  });

  it("flags a record that failed verification right in the story", async () => {
    const bad = trail([step(0, 0, "Registered", 0), { ...step(1, 1, "Listed", 0, eth(1)), record: record(1, { action: 1, price: eth(1), check: { ...record(1).check, status: "dataTampered" } }) }]);
    await show(bad);
    expect(screen.getByText("Data tampered")).toBeInTheDocument();
  });

  it("marks a product that is currently reserved", async () => {
    await show(trail([step(0, 0, "Registered", 0)], { reservation: { buyer: ROLES[1]!.address, amount: eth(1), expiresAt: "1" } }));
    expect(screen.getByText("◐ reserved")).toBeInTheDocument();
  });
});
