import { parseEther } from "ethers";
import type { ApiProduct } from "@dpp/shared";
import type { MarketFunction } from "./market";

export type ParamKind = "text" | "product" | "eth";

export interface ParamDef {
  name: string;
  label: string;
  kind: ParamKind;
  placeholder?: string;
}

export interface ActionDef {
  fn: MarketFunction;
  label: string;
  /** One sentence on what it does, for beginners. */
  summary: string;
  params: ParamDef[];
  /** `price`: the amount to send is the product's listed price (pre-filled, editable). */
  payable?: "price";
  /** Appends a record to the ledger when it succeeds. */
  writesRecord: boolean;
}

export const ACTIONS: ActionDef[] = [
  { fn: "registerProduct", label: "Register a product", summary: "Create a product. You become its first owner.", params: [{ name: "name", label: "Name", kind: "text", placeholder: "Laptop" }], writesRecord: true },
  { fn: "listForSale", label: "List for sale", summary: "Put a product you own up for sale at a price.", params: [{ name: "productId", label: "Product", kind: "product" }, { name: "price", label: "Price (ETH)", kind: "eth", placeholder: "1.0" }], writesRecord: true },
  { fn: "cancelListing", label: "Cancel listing", summary: "Take your product off sale. The listing stays in the history.", params: [{ name: "productId", label: "Product", kind: "product" }], writesRecord: true },
  { fn: "buy", label: "Buy now", summary: "Pay the exact price; ownership changes and the seller is paid immediately.", params: [{ name: "productId", label: "Product", kind: "product" }], payable: "price", writesRecord: true },
  { fn: "reserve", label: "Reserve (escrow)", summary: "Deposit the price into escrow and lock the product until the seller decides.", params: [{ name: "productId", label: "Product", kind: "product" }], payable: "price", writesRecord: true },
  { fn: "confirmSale", label: "Confirm sale", summary: "Seller accepts a reservation: ownership moves, payment becomes withdrawable.", params: [{ name: "productId", label: "Product", kind: "product" }], writesRecord: true },
  { fn: "revokeReservation", label: "Cancel my reservation", summary: "Buyer backs out. The deposit becomes refundable.", params: [{ name: "productId", label: "Product", kind: "product" }], writesRecord: true },
  { fn: "rejectReservation", label: "Reject reservation", summary: "Seller declines. The buyer's deposit becomes refundable.", params: [{ name: "productId", label: "Product", kind: "product" }], writesRecord: true },
  { fn: "expireReservation", label: "Expire reservation", summary: "Anyone can end a reservation once its period has passed.", params: [{ name: "productId", label: "Product", kind: "product" }], writesRecord: true },
  { fn: "withdraw", label: "Withdraw funds", summary: "Pull the money owed to you (sale proceeds or refunds).", params: [], writesRecord: false },
];

export const actionByFn = (fn: MarketFunction): ActionDef => ACTIONS.find((a) => a.fn === fn)!;

// ───────────────────── argument handling ─────────────────────

export type FormValues = Record<string, string>;

export interface Built {
  args: unknown[];
  /** Wei to attach to the transaction. */
  value?: bigint;
}

/** Turns what the user typed into contract arguments. Throws a readable Error for unusable input. */
export function buildCall(def: ActionDef, form: FormValues, products: ApiProduct[]): Built {
  const args: unknown[] = [];
  for (const p of def.params) {
    const raw = (form[p.name] ?? "").trim();
    if (p.kind === "text") args.push(form[p.name] ?? "");
    else if (p.kind === "product") {
      if (!/^\d+$/.test(raw)) throw new Error("Choose a product.");
      args.push(BigInt(raw));
    } else {
      if (raw === "") throw new Error(`Enter ${p.label.toLowerCase()}.`);
      try {
        args.push(parseEther(raw));
      } catch {
        throw new Error(`“${raw}” is not a valid amount of ETH.`);
      }
    }
  }

  let value: bigint | undefined;
  if (def.payable === "price") {
    const raw = (form.value ?? "").trim();
    if (raw !== "") {
      try {
        value = parseEther(raw);
      } catch {
        throw new Error(`“${raw}” is not a valid amount of ETH.`);
      }
    } else {
      const product = products.find((p) => p.id === String(args[0]));
      value = product ? BigInt(product.price) : 0n;
    }
  }
  return { args, value };
}

// ───────────────────── predictions ─────────────────────

export type PredictionLevel = "ok" | "warn" | "unknown";

export interface Prediction {
  level: PredictionLevel;
  /** Plain English, e.g. "You are not the owner, so this will revert." */
  message: string;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const OK: Prediction = { level: "ok", message: "This should succeed." };

/**
 * Guesses what the contract will do, from the products the UI already knows. It mirrors the contract's
 * own checks, but only as a hint: the real answer comes from simulating the call.
 */
export function predict(def: ActionDef, built: Built | null, products: ApiProduct[], me: string | null, nowSeconds = Math.floor(Date.now() / 1000)): Prediction {
  if (!me) return { level: "unknown", message: "Choose who you act as first." };
  if (def.fn === "withdraw") return { level: "unknown", message: "This succeeds only if there is money waiting for you." };
  if (!built) return { level: "unknown", message: "Fill in the form to see what will happen." };

  if (def.fn === "registerProduct") {
    return String(built.args[0] ?? "").length === 0 ? { level: "warn", message: "A product needs a name, so this will revert (EmptyName)." } : OK;
  }

  const id = String(built.args[0]);
  const p = products.find((x) => x.id === id);
  if (!p) return { level: "warn", message: `Product #${id} does not exist, so this will revert (ProductNotFound).` };

  const mine = same(p.owner, me);
  const r = p.reservation;

  switch (def.fn) {
    case "listForSale":
      if (!mine) return { level: "warn", message: "You are not the owner, so this will revert (NotProductOwner)." };
      if (r) return { level: "warn", message: "The product is reserved and locked, so this will revert (ProductReserved)." };
      return built.args[1] === 0n ? { level: "warn", message: "A price of 0 is not allowed (InvalidPrice)." } : OK;
    case "cancelListing":
      if (!mine) return { level: "warn", message: "You are not the owner, so this will revert (NotProductOwner)." };
      if (r) return { level: "warn", message: "The product is reserved and locked, so this will revert (ProductReserved)." };
      return p.forSale ? OK : { level: "warn", message: "It is not listed, so there is nothing to cancel (NotListed)." };
    case "buy":
    case "reserve":
      if (r) return { level: "warn", message: "Another buyer has reserved it, so this will revert (ProductReserved)." };
      if (!p.forSale) return { level: "warn", message: "It is not for sale (NotListed)." };
      if (mine) return { level: "warn", message: "You cannot buy your own product (CannotBuyOwnProduct)." };
      if ((built.value ?? 0n) !== BigInt(p.price)) return { level: "warn", message: "The amount differs from the listed price, so this will revert (IncorrectPayment)." };
      return OK;
    case "confirmSale":
      if (!mine) return { level: "warn", message: "Only the owner can confirm (NotProductOwner)." };
      if (!r) return { level: "warn", message: "There is no reservation to confirm (NotReserved)." };
      return BigInt(r.expiresAt) < BigInt(nowSeconds) ? { level: "warn", message: "The reservation period has ended (ReservationExpired)." } : OK;
    case "revokeReservation":
      if (!r) return { level: "warn", message: "There is no reservation to cancel (NotReserved)." };
      return same(r.buyer, me) ? OK : { level: "warn", message: "Only the buyer who reserved can cancel (NotReservationBuyer)." };
    case "rejectReservation":
      if (!mine) return { level: "warn", message: "Only the owner can reject (NotProductOwner)." };
      return r ? OK : { level: "warn", message: "There is no reservation to reject (NotReserved)." };
    case "expireReservation":
      if (!r) return { level: "warn", message: "There is no reservation to expire (NotReserved)." };
      return BigInt(r.expiresAt) >= BigInt(nowSeconds) ? { level: "warn", message: "The reservation period has not ended yet (ReservationNotExpired). The lab can fast-forward time." } : OK;
    default:
      return OK;
  }
}
