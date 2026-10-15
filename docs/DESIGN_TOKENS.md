# Design language

Shared visual vocabulary for the visualizer. The same names are used in `packages/shared/src/actions.ts` and in the Tailwind theme, so docs, code and UI stay consistent.

Colour is never the only signal: every state also has an icon and a text label.

## Ledger actions

| Action | Value | Colour | Icon | Meaning |
|---|---|---|---|---|
| Registered | 0 | blue `#2563eb` | ◆ | Product created; creator is first owner |
| Listed | 1 | amber `#d97706` | ◈ | Owner put the product up for sale |
| Delisted | 2 | grey `#6b7280` | ⊘ | Owner withdrew the listing |
| Sold | 3 | green `#16a34a` | ✔ | Payment made, ownership transferred |
| Reserved | 4 | violet `#7c3aed` | ◐ | Buyer's payment held in escrow, product locked |
| Revoked | 5 | orange `#ea580c` | ↺ | Reservation cancelled, payment returned |

## Verification status

| Status | Colour | Icon | Meaning |
|---|---|---|---|
| intact | green `#16a34a` | ✔ | Hash matches data, link matches previous hash, event log agrees |
| dataTampered | red `#dc2626` | ✘ | Recomputed hash differs from stored hash |
| linkBroken | red dashed `#dc2626` | ⛓ | `prevHash` differs from previous record's hash |
| anchorMismatch | purple `#9333ea` | ⚓ | Stored hashes disagree with the `RecordAppended` event log |

## Transaction lifecycle

| State | Style | Icon |
|---|---|---|
| draft / simulated / signed | outline | ✎ |
| pending | pulsing outline | ⏳ |
| mined (success) | solid | ✔ |
| recorded / verified | solid + link drawn | ⛓ |
| mined (reverted) | red | ✘ |
| replaced | struck-through grey | ⇄ |
| dropped | struck-through grey, dashed | ⌫ |

## Rules

- Light and dark themes both come from CSS variables; no component hard-codes a colour.
- Minimum contrast 4.5:1 for text, 3:1 for graphical objects.
- Motion respects `prefers-reduced-motion`: animations become an instant change plus a brief highlight.
- Hashes are shown as first 6 and last 4 hex characters; the full value is available on hover, focus and via a copy button.
- Amounts are shown in ETH with the exact wei value in a tooltip.
