import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyInBrowser } from "@/lib/verifyInBrowser";
import { validChain } from "@/test/fakes";
import { ChainStrip } from "./ChainStrip";
import { FRESH_MS, FreshWrapper, ScrambleText, useFreshRecords } from "./Fresh";

/** Pretend the OS asks for reduced motion. */
function prefersReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => { vi.useFakeTimers(); prefersReducedMotion(false); });
afterEach(() => { vi.useRealTimers(); prefersReducedMotion(false); });

describe("useFreshRecords", () => {
  it("treats what is already there as the baseline, and flags only later arrivals", () => {
    const all = validChain(5);
    const { result, rerender } = renderHook(({ records }) => useFreshRecords(records), { initialProps: { records: all.slice(0, 3) } });
    expect([...result.current]).toEqual([]);

    rerender({ records: all.slice(0, 4) });
    expect([...result.current]).toEqual(["3"]);
    rerender({ records: all });
    expect([...result.current].sort()).toEqual(["3", "4"]);
  });

  it("stops calling a record fresh after a short while", () => {
    const all = validChain(4);
    const { result, rerender } = renderHook(({ records }) => useFreshRecords(records), { initialProps: { records: all.slice(0, 3) } });
    rerender({ records: all });
    expect(result.current.has("3")).toBe(true);
    act(() => { vi.advanceTimersByTime(FRESH_MS + 10); });
    expect(result.current.has("3")).toBe(false);
  });

  it("starts over when the chain gets shorter (reset or rewind) and flags nothing then", () => {
    const all = validChain(6);
    const { result, rerender } = renderHook(({ records }) => useFreshRecords(records), { initialProps: { records: all.slice(0, 4) } });
    rerender({ records: all });
    expect(result.current.size).toBe(2);
    rerender({ records: all.slice(0, 2) });
    expect(result.current.size).toBe(0);
    rerender({ records: all.slice(0, 3) });
    expect([...result.current]).toEqual(["2"]);
  });

  it("flags nothing when disabled", () => {
    const all = validChain(4);
    const { result, rerender } = renderHook(({ records }) => useFreshRecords(records, false), { initialProps: { records: all.slice(0, 2) } });
    rerender({ records: all });
    expect(result.current.size).toBe(0);
  });
});

describe("ScrambleText", () => {
  const value = "0xabc123…f00d";
  const deterministic = () => 0.99; // always picks 'f'

  it("churns the digits, keeping the prefix, and settles on the real value", () => {
    render(<ScrambleText value={value} active random={deterministic} durationMs={400} />);
    const midway = document.body.textContent!;
    expect(midway.startsWith("0x")).toBe(true);
    expect(midway).toHaveLength(value.length);

    act(() => { vi.advanceTimersByTime(200); });
    expect(document.body.textContent).not.toBe(value);

    act(() => { vi.advanceTimersByTime(500); });
    expect(document.body.textContent).toBe(value);
  });

  it("shows the value immediately when not active", () => {
    render(<ScrambleText value={value} active={false} />);
    expect(document.body.textContent).toBe(value);
  });

  it("shows the value immediately when the user prefers reduced motion", () => {
    prefersReducedMotion(true);
    render(<ScrambleText value={value} active />);
    expect(document.body.textContent).toBe(value);
  });
});

describe("FreshWrapper", () => {
  it("does nothing for a block that is not new", () => {
    render(<FreshWrapper fresh={false}><span>child</span></FreshWrapper>);
    expect(screen.getByText("child").parentElement).not.toHaveAttribute("data-fresh");
  });

  it("animates a new block", () => {
    render(<FreshWrapper fresh><span>child</span></FreshWrapper>);
    expect(screen.getByText("child").parentElement).toHaveAttribute("data-motion", "full");
  });

  it("only highlights a new block when the user prefers reduced motion", () => {
    prefersReducedMotion(true);
    render(<FreshWrapper fresh><span>child</span></FreshWrapper>);
    const wrapper = screen.getByText("child").parentElement!;
    expect(wrapper).toHaveAttribute("data-motion", "reduced");
    expect(wrapper).toHaveClass("ring-2");
  });
});

describe("ChainStrip with a record that arrives", () => {
  it("marks the new block and its link, then settles", () => {
    const all = validChain(4);
    const { rerender, container } = render(<ChainStrip records={all.slice(0, 3)} verification={verifyInBrowser(all.slice(0, 3))} />);
    expect(container.querySelector("[data-fresh]")).toBeNull();

    rerender(<ChainStrip records={all} verification={verifyInBrowser(all)} />);
    const fresh = [...container.querySelectorAll("[data-fresh]")];
    expect(fresh.length).toBeGreaterThanOrEqual(2); // the block wrapper and the link line
    expect(container.querySelector("[data-fresh-prev]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Record 3:/ })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(FRESH_MS + 100); });
    expect(container.querySelector("[data-fresh]")).toBeNull();
    expect(container.querySelector("[data-fresh-prev]")).toBeNull();
    // the hash has settled on its real value
    expect(screen.getByRole("button", { name: /^Record 3:/ })).toHaveTextContent(all[3]!.hash.slice(0, 8));
  });

  it("animates nothing when animation is switched off", () => {
    const all = validChain(4);
    const { rerender, container } = render(<ChainStrip records={all.slice(0, 3)} verification={verifyInBrowser(all.slice(0, 3))} animate={false} />);
    rerender(<ChainStrip records={all} verification={verifyInBrowser(all)} animate={false} />);
    expect(container.querySelector("[data-fresh]")).toBeNull();
  });

  it("flashes instead of moving for users who prefer reduced motion", () => {
    prefersReducedMotion(true);
    const all = validChain(4);
    const { rerender, container } = render(<ChainStrip records={all.slice(0, 3)} verification={verifyInBrowser(all.slice(0, 3))} />);
    rerender(<ChainStrip records={all} verification={verifyInBrowser(all)} />);
    expect(container.querySelector('[data-motion="reduced"]')).not.toBeNull();
    expect(container.querySelector('[data-motion="full"]')).toBeNull();
  });
});
