import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiProduct } from "@dpp/shared";
import { verifyInBrowser } from "@/lib/verifyInBrowser";
import { useSelection } from "@/store/selection";
import { validChain } from "@/test/fakes";
import { ChainControls } from "./ChainControls";
import { ChainStrip, type ChainStripHandle } from "./ChainStrip";
import { Minimap } from "./Minimap";

beforeEach(() => useSelection.setState({ selected: null, productFilter: null }));

describe("ChainStrip: compact and Ethereum-block lane", () => {
  it("uses narrower cards when compact", () => {
    const records = validChain(3);
    const { rerender } = render(<ChainStrip records={records} verification={verifyInBrowser(records)} />);
    expect(screen.getByRole("button", { name: /^Record 1:/ })).toHaveStyle({ width: "208px" });
    rerender(<ChainStrip records={records} verification={verifyInBrowser(records)} compact />);
    expect(screen.getByRole("button", { name: /^Record 1:/ })).toHaveStyle({ width: "124px" });
    expect(screen.getByRole("button", { name: /^Record 1:/ })).not.toHaveTextContent("Laptop");
  });

  it("names the Ethereum block of each record, and groups records of the same block", () => {
    const records = validChain(4).map((r, i) => ({ ...r, blockNumber: [5, 5, 6, 9][i]! }));
    const { container } = render(<ChainStrip records={records} verification={verifyInBrowser(records)} showBlocks />);
    const lane = [...container.querySelectorAll("[data-lane-block]")];
    expect(lane.map((l) => l.getAttribute("data-lane-block"))).toEqual(["5", "5", "6", "9"]);
    expect(screen.getAllByText(/^Ethereum block/)).toHaveLength(3);         // 5, 6, 9 are announced
    expect(screen.getAllByText("same Ethereum block")).toHaveLength(1);     // record 1 continues block 5
  });

  it("shows no lane unless asked", () => {
    const records = validChain(2);
    render(<ChainStrip records={records} verification={verifyInBrowser(records)} />);
    expect(screen.queryByText(/Ethereum block/)).not.toBeInTheDocument();
  });
});

/** jsdom never scrolls; emulate a browser applying a scrollTo and firing the scroll event. */
function emulateScrolling() {
  const scrollTo = vi.fn(function (this: HTMLElement, opts: ScrollToOptions | number) {
    this.scrollLeft = typeof opts === "number" ? opts : (opts.left ?? 0);
    this.dispatchEvent(new Event("scroll"));
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true, writable: true });
  // A browser knows how wide the scrolled content is; the virtualizer clamps offsets to it.
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) { return parseFloat((this.firstElementChild as HTMLElement | null)?.style.width ?? "") || 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
  return scrollTo;
}

describe("ChainStrip handle", () => {
  it("scrolls a faraway record into view and focuses it", async () => {
    emulateScrolling();
    const records = validChain(600);
    const ref = createRef<ChainStripHandle>();
    render(<ChainStrip ref={ref} records={records} verification={verifyInBrowser(records)} />);
    expect(screen.queryByRole("button", { name: /^Record 400:/ })).not.toBeInTheDocument();

    ref.current!.scrollToRecord(400);
    expect(await screen.findByRole("button", { name: /^Record 400:/ })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Record 400:/ })));
  });

  it("reports which records are on screen", async () => {
    const records = validChain(600);
    const onVisibleRange = vi.fn();
    render(<ChainStrip records={records} verification={verifyInBrowser(records)} onVisibleRange={onVisibleRange} />);
    await waitFor(() => expect(onVisibleRange).toHaveBeenCalled());
    const [from, to] = onVisibleRange.mock.calls.at(-1)![0];
    expect(from).toBe(0);
    expect(to).toBeGreaterThan(2);
    expect(to).toBeLessThan(30);
  });
});

describe("Minimap", () => {
  it("shows one cell per record for a short chain and colours problems", () => {
    const records = validChain(5);
    records[2] = { ...records[2]!, price: "9" };
    const { container } = render(<Minimap checks={verifyInBrowser(records).checks} onJump={() => {}} />);
    const cells = [...container.querySelectorAll("button")];
    expect(cells.map((c) => c.getAttribute("data-status"))).toEqual(["intact", "intact", "dataTampered", "intact", "intact"]);
    expect(screen.getByRole("group", { name: /Overview/ })).toHaveAccessibleName("Overview of 5 records, 1 with problems");
  });

  it("buckets a long chain but never hides a problem inside a bucket", () => {
    const records = validChain(1000);
    records[777] = { ...records[777]!, price: "9" };
    const { container } = render(<Minimap checks={verifyInBrowser(records).checks} onJump={() => {}} maxCells={100} />);
    const cells = [...container.querySelectorAll("button")];
    expect(cells.length).toBeLessThanOrEqual(100);
    const bad = cells.filter((c) => c.getAttribute("data-status") !== "intact");
    expect(bad).toHaveLength(1);
    expect(Number(bad[0]!.getAttribute("data-from"))).toBeLessThanOrEqual(777);
  });

  it("jumps to the record when a cell is clicked, and marks the part on screen", async () => {
    const onJump = vi.fn();
    const { container } = render(<Minimap checks={verifyInBrowser(validChain(5)).checks} onJump={onJump} visible={[1, 2]} />);
    const cells = [...container.querySelectorAll("button")];
    await userEvent.click(cells[3]!);
    expect(onJump).toHaveBeenCalledWith(3);
    expect(cells[1]).toHaveClass("outline");
    expect(cells[4]).not.toHaveClass("outline");
  });

  it("renders nothing for an empty ledger", () => {
    const { container } = render(<Minimap checks={[]} onJump={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChainControls", () => {
  const products: ApiProduct[] = [{ id: "1", name: "Laptop", owner: "0x" + "11".repeat(20), price: "0", forSale: false, reservation: null }];
  const setup = (over: Partial<React.ComponentProps<typeof ChainControls>> = {}) => {
    const props = {
      recordCount: 10, products, productFilter: null, compact: false, showBlocks: false,
      onJump: vi.fn(), onProductFilter: vi.fn(), onCompact: vi.fn(), onShowBlocks: vi.fn(), ...over,
    };
    render(<ChainControls {...props} />);
    return props;
  };

  it("jumps to a valid record", async () => {
    const p = setup();
    await userEvent.type(screen.getByRole("textbox", { name: /Jump to record/ }), "7{Enter}");
    expect(p.onJump).toHaveBeenCalledWith(7);
  });

  it.each(["", "abc", "-1", "10", "2.5"])("rejects %j with a helpful message", async (text) => {
    const p = setup();
    if (text) await userEvent.type(screen.getByRole("textbox", { name: /Jump to record/ }), text);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(p.onJump).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("0 to 9");
  });

  it("explains that an empty ledger has nothing to jump to", async () => {
    setup({ recordCount: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("alert")).toHaveTextContent("empty");
  });

  it("clears the error when the user types again", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Jump to record/ }), "3");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("filters by product, and toggles compact and the Ethereum-block lane", async () => {
    const p = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Follow product/ }), "1");
    expect(p.onProductFilter).toHaveBeenCalledWith("1");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Follow product/ }), "");
    expect(p.onProductFilter).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole("checkbox", { name: "Compact" }));
    expect(p.onCompact).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Show Ethereum blocks" }));
    expect(p.onShowBlocks).toHaveBeenCalledWith(true);
  });
});
