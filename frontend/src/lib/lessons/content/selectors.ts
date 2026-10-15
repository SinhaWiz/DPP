/** Parts of the page a lesson step can point at. They match the aria-labels the components already carry. */
export const T = {
  chain: '[aria-label="Ledger chain"]',
  actions: 'aside[aria-label="Actions"]',
  actAs: 'select[aria-label="Act as"]',
  dock: 'section[aria-label="Transactions"]',
  mining: '[aria-label="Mining mode"]',
  failed: 'section[aria-label="Failed attempts"]',
  rules: '[data-tour="break-rules"]',
  pull: 'section[aria-label="Pull payments"]',
  timeline: 'section[aria-label^="Timeline of"]',
  slots: 'section[aria-label="Storage slots"]',
  cost: 'section[aria-label="What it cost to store"]',
  readback: 'section[aria-label="Three ways to read it back"]',
  levels: 'section[aria-label="Attack levels"]',
  console: 'section[aria-label="Verification console"]',
  explain: 'aside[aria-label="What\'s happening"]',
  nav: 'nav[aria-label="Main"]',
} as const;

export const mined = (fn: string) => (now: { minedByFn: Record<string, number> }, start: { minedByFn: Record<string, number> }) =>
  (now.minedByFn[fn] ?? 0) > (start.minedByFn[fn] ?? 0);
