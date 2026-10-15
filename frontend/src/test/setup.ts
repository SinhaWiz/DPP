import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// Node 26 ships its own `localStorage` global that shadows jsdom's and is undefined without a flag.
// Give tests a plain in-memory one.
function memoryStorage(): Storage {
  let data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => { data = new Map(); },
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}
Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });

// jsdom has no layout engine or matchMedia; give components the little they ask for.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// jsdom lays nothing out, so every element measures 0x0 and a virtualized list would render no rows.
// Give elements a viewport-sized box; virtualization then behaves as it does in a browser.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 180 });
