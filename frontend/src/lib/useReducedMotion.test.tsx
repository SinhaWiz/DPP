import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePrefersReducedMotion } from "./useReducedMotion";

function fakeMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mq = { matches: initial, media: "", onchange: null, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l), addListener() {}, removeListener() {}, dispatchEvent: () => false };
  window.matchMedia = (() => mq) as unknown as typeof window.matchMedia;
  return { set(v: boolean) { mq.matches = v; listeners.forEach((l) => l()); }, listeners };
}
const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

describe("usePrefersReducedMotion", () => {
  it("reflects the system setting", () => {
    fakeMedia(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
    fakeMedia(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it("follows the setting being changed while the page is open, and cleans up", () => {
    const media = fakeMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
