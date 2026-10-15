import { parseEther } from "ethers";
import type { MarketFunction } from "./market";

/** Built-in accounts by role index (see packages/shared/src/roles.json). */
export const ROLE = { Manufacturer: 0, Distributor: 1, Retailer: 2, Customer: 3, Outsider: 4 } as const;
const ONE = parseEther("1");
const DAY = 24 * 3600;

export interface Step {
  role: number;
  fn: MarketFunction;
  args: unknown[];
  value?: bigint;
  /** What this step does, shown while it runs. */
  label: string;
}

export interface Plan {
  /** Real transactions that create the situation, run first (and must succeed). */
  setup: Step[];
  /** Seconds to move the chain's clock forward after the setup. */
  advanceSeconds?: number;
  /** The call that breaks a rule. */
  act: Step;
}

export interface Rule {
  /** The contract error this teaches. */
  error: string;
  title: string;
  /** What the learner should take away. */
  teaches: string;
  /** Needs the Broken Wallet contract, which only the "Every error" scenario can drive. */
  scenarioOnly?: boolean;
  plan(nextProductId: bigint): Plan;
}

const register = (): Step => ({ role: ROLE.Manufacturer, fn: "registerProduct", args: ["Rule demo"], label: "Manufacturer registers a demo product" });
const list = (P: bigint): Step => ({ role: ROLE.Manufacturer, fn: "listForSale", args: [P, ONE], label: "Manufacturer lists it for 1 ETH" });
const reserve = (P: bigint): Step => ({ role: ROLE.Retailer, fn: "reserve", args: [P], value: ONE, label: "Retailer reserves it (1 ETH into escrow)" });

export const RULES: Rule[] = [
  { error: "EmptyName", title: "Register a product with no name", teaches: "The contract checks its inputs and refuses an empty name.",
    plan: () => ({ setup: [], act: { role: ROLE.Outsider, fn: "registerProduct", args: [""], label: "Outsider registers a product named “”" } }) },
  { error: "InvalidPrice", title: "List a product at price 0", teaches: "A price of 0 is reserved for “not for sale”, so listing at 0 is refused.",
    plan: (P) => ({ setup: [register()], act: { role: ROLE.Manufacturer, fn: "listForSale", args: [P, 0n], label: "Manufacturer lists it at 0" } }) },
  { error: "ProductNotFound", title: "Buy a product that does not exist", teaches: "Ids are checked before anything else happens.",
    plan: () => ({ setup: [], act: { role: ROLE.Customer, fn: "buy", args: [99999n], value: ONE, label: "Customer buys product #99999" } }) },
  { error: "NotProductOwner", title: "List somebody else's product", teaches: "Only the current owner may change a listing.",
    plan: (P) => ({ setup: [register()], act: { role: ROLE.Outsider, fn: "listForSale", args: [P, ONE], label: "Outsider lists the Manufacturer's product" } }) },
  { error: "NotListed", title: "Buy a product that is not for sale", teaches: "A product can only be bought while it is listed.",
    plan: (P) => ({ setup: [register()], act: { role: ROLE.Customer, fn: "buy", args: [P], value: ONE, label: "Customer buys an unlisted product" } }) },
  { error: "CannotBuyOwnProduct", title: "Buy your own product", teaches: "Buyer and seller must be different accounts.",
    plan: (P) => ({ setup: [register(), list(P)], act: { role: ROLE.Manufacturer, fn: "buy", args: [P], value: ONE, label: "Manufacturer buys their own product" } }) },
  { error: "IncorrectPayment", title: "Pay the wrong amount", teaches: "The exact price must be sent, not more and not less.",
    plan: (P) => ({ setup: [register(), list(P)], act: { role: ROLE.Customer, fn: "buy", args: [P], value: ONE / 2n, label: "Customer pays 0.5 ETH for a 1 ETH product" } }) },
  { error: "PaymentFailed", title: "Sell to a contract that refuses ETH", teaches: "A failed payment rolls back the whole sale, and why pull payments exist.", scenarioOnly: true,
    plan: () => { throw new Error("needs the Broken Wallet contract: run the “Every error” scenario"); } },
  { error: "ProductReserved", title: "Change a product that is reserved", teaches: "A reservation locks the product until the seller decides.",
    plan: (P) => ({ setup: [register(), list(P), reserve(P)], act: { role: ROLE.Manufacturer, fn: "listForSale", args: [P, ONE * 2n], label: "Manufacturer re-lists a reserved product" } }) },
  { error: "NotReserved", title: "Confirm a sale nobody reserved", teaches: "There is nothing to confirm until a buyer has put money in escrow.",
    plan: (P) => ({ setup: [register(), list(P)], act: { role: ROLE.Manufacturer, fn: "confirmSale", args: [P], label: "Manufacturer confirms a non-existent reservation" } }) },
  { error: "NotReservationBuyer", title: "Cancel someone else's reservation", teaches: "Only the buyer who reserved can back out; the seller uses reject instead.",
    plan: (P) => ({ setup: [register(), list(P), reserve(P)], act: { role: ROLE.Customer, fn: "revokeReservation", args: [P], label: "Customer cancels the Retailer's reservation" } }) },
  { error: "ReservationNotExpired", title: "Expire a reservation too early", teaches: "Anyone may end a reservation, but only after its period (1 day) has passed.",
    plan: (P) => ({ setup: [register(), list(P), reserve(P)], act: { role: ROLE.Outsider, fn: "expireReservation", args: [P], label: "Outsider expires it right away" } }) },
  { error: "ReservationExpired", title: "Confirm a sale after the deadline", teaches: "The seller has one day to answer; later, only a refund is possible.",
    plan: (P) => ({ setup: [register(), list(P), reserve(P)], advanceSeconds: DAY + 5, act: { role: ROLE.Manufacturer, fn: "confirmSale", args: [P], label: "Manufacturer confirms one day and five seconds later" } }) },
  { error: "NothingToWithdraw", title: "Withdraw with no balance", teaches: "Money is only withdrawable after a confirmed sale or a revoked reservation.",
    plan: () => ({ setup: [], act: { role: ROLE.Outsider, fn: "withdraw", args: [], label: "Outsider withdraws nothing" } }) },
  { error: "WithdrawFailed", title: "Withdraw to a contract that refuses ETH", teaches: "With pull payments such an account can only hurt itself; its balance stays safe.", scenarioOnly: true,
    plan: () => { throw new Error("needs the Broken Wallet contract: run the “Every error” scenario"); } },
];
