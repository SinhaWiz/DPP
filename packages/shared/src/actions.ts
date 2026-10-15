import { Action } from "./types";

export interface ActionMeta {
  label: string;
  /** Hex colour, kept in sync with docs/DESIGN_TOKENS.md. */
  color: string;
  icon: string;
  /** One sentence for tooltips. */
  summary: string;
  /** Longer plain-English explanation for the explanation panel. */
  explanation: string;
}

export const ACTION_META: Record<Action, ActionMeta> = {
  [Action.Registered]: {
    label: "Registered",
    color: "#2563eb",
    icon: "◆",
    summary: "Product created; the creator is its first owner.",
    explanation:
      "A new product enters the ledger. This record is the start of that product's trail: everything that later happens to it is linked back to here.",
  },
  [Action.Listed]: {
    label: "Listed",
    color: "#d97706",
    icon: "◈",
    summary: "The owner put the product up for sale.",
    explanation:
      "The owner set a price. Listing again with a different price is allowed and creates another Listed record, so price changes stay visible.",
  },
  [Action.Delisted]: {
    label: "Delisted",
    color: "#6b7280",
    icon: "⊘",
    summary: "The owner withdrew the listing.",
    explanation:
      "The listing is withdrawn, but the fact that it was listed stays in the ledger. Append-only ledgers don't delete; they record the reversal.",
  },
  [Action.Sold]: {
    label: "Sold",
    color: "#16a34a",
    icon: "✔",
    summary: "The buyer paid and ownership was transferred.",
    explanation:
      "Payment was made and the product changed hands. The actor is the seller; the counterparty is the buyer.",
  },
  [Action.Reserved]: {
    label: "Reserved",
    color: "#7c3aed",
    icon: "◐",
    summary: "A buyer's payment is held in escrow and the product is locked.",
    explanation:
      "The buyer deposited the price into the contract. The product is locked: nobody else can buy it until the seller confirms, someone revokes, or the reservation expires.",
  },
  [Action.Revoked]: {
    label: "Revoked",
    color: "#ea580c",
    icon: "↺",
    summary: "A reservation was cancelled and the deposit returned.",
    explanation:
      "The purchase did not complete. The deposit becomes withdrawable by the buyer, and the product is for sale again. The earlier Reserved record is not erased: a revocation is a new record that reverses it.",
  },
};

export function actionLabel(action: Action): string {
  return ACTION_META[action]?.label ?? `Unknown(${action})`;
}
