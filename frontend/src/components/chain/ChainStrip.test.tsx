import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyInBrowser } from "@/lib/verifyInBrowser";
import { useSelection } from "@/store/selection";
import { validChain } from "@/test/fakes";
import { ChainStrip } from "./ChainStrip";

const renderChain = (records = validChain(4), props: object = {}) =>
  render(<ChainStrip records={records} verification={verifyInBrowser(records)} initialWidth={1200} {...props} />);

beforeEach(() => useSelection.setState({ selected: null, productFilter: null }));

describe("ChainStrip", () => {
  it("shows an empty chain as a genesis marker with an invitation", () => {
    renderChain([]);
    expect(screen.getByText("Genesis")).toBeInTheDocument();
    expect(screen.getByText(/chain is empty/i)).toBeInTheDocument();
  });

  it("draws the genesis marker, then each record linked to the next", () => {
    renderChain();
    expect(screen.getByRole("group", { name: "Ledger chain" })).toBeInTheDocument();
    expect(screen.getByText("Genesis")).toBeInTheDocument();
    for (const i of [0, 1, 2, 3]) expect(screen.getByRole("button", { name: new RegExp(`^Record ${i}:`) })).toBeInTheDocument();
    // genesis→#0, #0→#1, #1→#2, #2→#3 (nothing after the last block)
    expect(screen.getAllByRole("img", { name: /^Link intact/ })).toHaveLength(4);
    expect(screen.queryByRole("img", { name: /^Link broken/ })).not.toBeInTheDocument();
  });

  it("labels each block with what it is, whose product, and whether it verified", () => {
    renderChain();
    const card = screen.getByRole("button", { name: /^Record 1:/ });
    expect(card).toHaveAccessibleName("Record 1: Listed, Laptop. Intact.");
    expect(card).toHaveTextContent("#1");          // the record's index
    expect(card).toHaveTextContent("Laptop #1");   // the product and its id
    expect(within(card).getByText("1 ETH")).toBeInTheDocument();
    expect(within(card).getByText("prev")).toBeInTheDocument();
  });

  it("only renders the blocks near the viewport", () => {
    renderChain(validChain(500));
    const rendered = screen.getAllByRole("button", { name: /^Record \d+:/ });
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(25); // not all 500
    expect(screen.getByRole("button", { name: /^Record 0:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Record 499:/ })).not.toBeInTheDocument();
  });

  it("marks an edited record as tampered, and leaves its neighbours' links alone", () => {
    const records = validChain(4);
    records[2] = { ...records[2]!, price: "5" };
    renderChain(records);
    expect(screen.getByRole("button", { name: /^Record 2:.*Data tampered/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Record 1:.*Intact/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Link broken/ })).not.toBeInTheDocument();
  });

  it("draws a broken link when a record no longer points at the one before it", () => {
    const records = validChain(4);
    records[2] = { ...records[2]!, prevHash: "0x" + "ee".repeat(32) };
    renderChain(records);
    const broken = screen.getAllByRole("img", { name: /^Link broken/ });
    expect(broken).toHaveLength(1);
    expect(broken[0]).toHaveAccessibleName("Link broken: prevHash equals hash of #1 is false");
    expect(broken[0]).toHaveAttribute("data-link-ok", "false");
  });

  it("marks a log mismatch distinctly from tampering", () => {
    const records = validChain(3);
    records[1] = { ...records[1]!, witness: { ...records[1]!.witness!, hash: "0x" + "aa".repeat(32) } };
    renderChain(records);
    expect(screen.getByRole("button", { name: /^Record 1:.*Log mismatch/ })).toBeInTheDocument();
  });

  it("selects a record on click", async () => {
    renderChain();
    await userEvent.click(screen.getByRole("button", { name: /^Record 2:/ }));
    expect(useSelection.getState().selected).toBe(2n);
    expect(screen.getByRole("button", { name: /^Record 2:/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Record 1:/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("dims blocks outside the followed product", () => {
    const records = validChain(3);
    records[1] = { ...records[1]!, productId: "2" };
    useSelection.setState({ productFilter: "2" });
    renderChain(records);
    expect(screen.getByRole("button", { name: /^Record 1:/ })).not.toHaveClass("opacity-35");
    expect(screen.getByRole("button", { name: /^Record 0:/ })).toHaveClass("opacity-35");
  });

  describe("keyboard", () => {
    it("keeps one block in the tab order and moves between blocks with the arrow keys", async () => {
      renderChain();
      const tabbable = () => screen.getAllByRole("button", { name: /^Record/ }).filter((b) => b.getAttribute("tabindex") === "0");
      expect(tabbable()).toHaveLength(1);
      expect(tabbable()[0]).toHaveAccessibleName(/^Record 0:/);

      tabbable()[0]!.focus();
      await userEvent.keyboard("{ArrowRight}");
      await vi_waitFrame();
      expect(tabbable()[0]).toHaveAccessibleName(/^Record 1:/);
      await userEvent.keyboard("{End}");
      await vi_waitFrame();
      expect(tabbable()[0]).toHaveAccessibleName(/^Record 3:/);
      await userEvent.keyboard("{ArrowRight}"); // cannot go past the end
      await vi_waitFrame();
      expect(tabbable()[0]).toHaveAccessibleName(/^Record 3:/);
      await userEvent.keyboard("{Home}");
      await vi_waitFrame();
      expect(tabbable()[0]).toHaveAccessibleName(/^Record 0:/);
    });

    it("opens a record with Enter", async () => {
      renderChain();
      screen.getByRole("button", { name: /^Record 1:/ }).focus();
      await userEvent.keyboard("{Enter}");
      expect(useSelection.getState().selected).toBe(1n);
    });
  });

  describe("following the newest record", () => {
    const scrollAway = () => {
      const strip = screen.getByRole("group", { name: "Ledger chain" });
      Object.defineProperty(strip, "scrollWidth", { value: 10_000, configurable: true });
      Object.defineProperty(strip, "clientWidth", { value: 1_000, configurable: true });
      Object.defineProperty(strip, "scrollLeft", { value: 0, configurable: true });
      fireEvent.scroll(strip);
    };

    it("offers a way back once the user scrolls away from the end, and hides it again after", async () => {
      renderChain();
      expect(screen.queryByRole("button", { name: /Jump to latest/ })).not.toBeInTheDocument();
      scrollAway();
      const jump = await screen.findByRole("button", { name: /Jump to latest/ });
      await userEvent.click(jump);
      expect(screen.queryByRole("button", { name: /Jump to latest/ })).not.toBeInTheDocument();
    });
  });

  it("lets a caller wrap each card (for tooltips)", () => {
    renderChain(validChain(2), {
      renderCard: (card: React.ReactElement, record: { index: string }) => <div data-testid={`wrap-${record.index}`}>{card}</div>,
    });
    expect(within(screen.getByTestId("wrap-1")).getByRole("button", { name: /^Record 1:/ })).toBeInTheDocument();
  });
});

/** Focus moves on the next animation frame. */
const vi_waitFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
