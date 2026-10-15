import { formatEther, isHexString } from "ethers";
import { marketInterface } from "./abi";

export type ErrorKind = "custom" | "revertString" | "panic" | "wallet" | "network" | "unknown";

export interface ErrorExplanation {
  kind: ErrorKind;
  /** Custom error name, or a code such as ACTION_REJECTED. */
  name: string;
  /** Short heading. */
  title: string;
  /** Plain-English reason. */
  explanation: string;
  /** What to change so it works. */
  fix: string;
  /** Decoded arguments, already formatted for display. */
  args: Record<string, string>;
  /** True when the transaction would revert on chain (so nothing is recorded in the ledger). */
  reverts: boolean;
}

export interface ExplainContext {
  /** Turns an address into a role name ("Retailer (0xabc…)"). */
  labelAddress?: (address: string) => string;
}

const eth = (v: unknown) => `${formatEther(v as bigint)} ETH`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Args = Record<string, unknown>;
interface Entry {
  title: string;
  explain: (a: Args, who: (addr: string) => string) => string;
  fix: string;
}

const id = (a: Args) => `#${String(a.productId)}`;

const CUSTOM: Record<string, Entry> = {
  EmptyName: {
    title: "Empty product name",
    explain: () => "Products need a name. The contract refuses an empty string.",
    fix: "Type a name for the product.",
  },
  InvalidPrice: {
    title: "Invalid price",
    explain: () => "A listing price must be above 0 wei. A price of 0 would mean \"not for sale\".",
    fix: "Enter a price greater than zero, or use Cancel listing to take the product off sale.",
  },
  ProductNotFound: {
    title: "Product not found",
    explain: (a) => `Product ${id(a)} was never registered.`,
    fix: "Pick an existing product, or register it first.",
  },
  NotProductOwner: {
    title: "Not the owner",
    explain: (a, who) => `Only the current owner of product ${id(a)} may do this, and ${who(String(a.caller))} is not the owner.`,
    fix: "Switch to the account that owns the product.",
  },
  NotListed: {
    title: "Not for sale",
    explain: (a) => `Product ${id(a)} is not listed, so it can't be bought, reserved or delisted.`,
    fix: "Ask the owner to list it first.",
  },
  CannotBuyOwnProduct: {
    title: "Can't buy your own product",
    explain: (a) => `The buyer and the seller of product ${id(a)} are the same account.`,
    fix: "Switch to a different account to buy it.",
  },
  IncorrectPayment: {
    title: "Wrong payment amount",
    explain: (a) => `The exact price must be sent: expected ${eth(a.expected)}, sent ${eth(a.sent)}.`,
    fix: "Send exactly the listed price.",
  },
  PaymentFailed: {
    title: "Seller can't receive ETH",
    explain: (a, who) =>
      `${who(String(a.recipient))} is a contract that refuses ETH, so the payment failed. Because payment is part of the same transaction, the whole sale was rolled back: ownership did not change and nothing was recorded.`,
    fix: "Use the escrow flow (reserve → confirm → withdraw), where the seller pulls their own funds.",
  },
  ProductReserved: {
    title: "Product is reserved",
    explain: (a) => `Another buyer has reserved product ${id(a)}. It is locked until the seller confirms, someone revokes, or the reservation expires.`,
    fix: "Wait for the reservation to end, or ask the seller to reject it.",
  },
  NotReserved: {
    title: "No reservation",
    explain: (a) => `Product ${id(a)} has no reservation to confirm, revoke, reject or expire.`,
    fix: "Reserve the product first.",
  },
  NotReservationBuyer: {
    title: "Not the reserving buyer",
    explain: (a, who) => `Only the buyer who reserved product ${id(a)} can revoke it, and ${who(String(a.caller))} is not that buyer.`,
    fix: "Switch to the buyer account, or have the seller reject the reservation.",
  },
  ReservationExpired: {
    title: "Reservation expired",
    explain: (a) => `The reservation on product ${id(a)} ended at ${new Date(Number(a.expiredAt) * 1000).toLocaleString()}, so the seller can no longer confirm it.`,
    fix: "Expire the reservation so the buyer can withdraw the refund.",
  },
  ReservationNotExpired: {
    title: "Reservation still active",
    explain: (a) => `Anyone can expire a reservation, but only after ${new Date(Number(a.expiresAt) * 1000).toLocaleString()}.`,
    fix: "Wait until the period ends (the lab can fast-forward time).",
  },
  NothingToWithdraw: {
    title: "Nothing to withdraw",
    explain: (a, who) => `${who(String(a.account))} has no balance waiting. Balances appear after a confirmed sale (seller) or a revoked reservation (buyer).`,
    fix: "Complete a sale or revoke a reservation first.",
  },
  WithdrawFailed: {
    title: "Withdrawal failed",
    explain: (a, who) => `${who(String(a.account))} is a contract that refuses ETH. Its balance is still safe in the contract: nothing was lost, and nobody else is blocked.`,
    fix: "Use an account that can receive ETH.",
  },
  RecordNotFound: {
    title: "Record not found",
    explain: (a) => `There is no ledger record at index ${String(a.index)}.`,
    fix: "Ask for an index below the ledger length.",
  },
  InvalidRange: {
    title: "Invalid range",
    explain: (a) => `The range [${String(a.fromIndex)}, ${String(a.toIndex)}) is backwards or goes past the end of the ledger.`,
    fix: "Use from ≤ to ≤ ledger length.",
  },
};

const PANIC_REASONS: Record<number, string> = {
  0x01: "an assertion failed",
  0x11: "an arithmetic operation overflowed or underflowed",
  0x12: "a division or modulo by zero",
  0x21: "an invalid enum value was used",
  0x32: "an array index was out of bounds",
  0x41: "too much memory was allocated",
};

const base = (over: Partial<ErrorExplanation>): ErrorExplanation => ({
  kind: "unknown",
  name: "Unknown",
  title: "Transaction failed",
  explanation: "The transaction failed for a reason that could not be decoded.",
  fix: "Check the console for details.",
  args: {},
  reverts: false,
  ...over,
});

/** Explains raw revert data (the bytes a failed call returns). */
export function explainRevert(data: string, ctx: ExplainContext = {}): ErrorExplanation {
  const who = (addr: string) => (ctx.labelAddress ? ctx.labelAddress(addr) : short(addr));
  if (!isHexString(data) || data.length < 10) {
    return base({
      title: "Reverted without a reason",
      explanation: "The call reverted and returned no error data.",
      fix: "Check the preconditions of the function being called.",
      reverts: true,
    });
  }

  let parsed;
  try {
    parsed = marketInterface.parseError(data);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return base({
      title: "Unknown error",
      explanation: `The contract reverted with data ${data.slice(0, 10)}…, which is not one of its known errors.`,
      reverts: true,
    });
  }

  if (parsed.name === "Error") {
    const reason = String(parsed.args[0]);
    return base({
      kind: "revertString", name: "Error", title: "Reverted with a message",
      explanation: `The contract reverted with the message "${reason}".`, args: { reason }, reverts: true,
    });
  }
  if (parsed.name === "Panic") {
    const code = Number(parsed.args[0]);
    return base({
      kind: "panic", name: "Panic", title: "Internal error",
      explanation: `The contract hit a built-in safety check: ${PANIC_REASONS[code] ?? `panic code 0x${code.toString(16)}`}.`,
      args: { code: `0x${code.toString(16)}` }, reverts: true,
    });
  }

  const entry = CUSTOM[parsed.name];
  const args: Args = {};
  parsed.fragment.inputs.forEach((input, i) => { args[input.name] = parsed.args[i]; });
  const shown: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) shown[k] = typeof v === "bigint" ? v.toString() : String(v);

  return base({
    kind: "custom",
    name: parsed.name,
    title: entry?.title ?? parsed.name,
    explanation: entry ? entry.explain(args, who) : `The contract reverted with ${parsed.name}.`,
    fix: entry?.fix ?? "Check the arguments of the call.",
    args: shown,
    reverts: true,
  });
}

/** Finds revert bytes anywhere inside an ethers / JSON-RPC error object. */
export function findRevertData(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== "object" || depth > 6) return null;
  const o = err as Record<string, unknown>;
  for (const key of ["data", "returnData", "revert"]) {
    const v = o[key];
    if (typeof v === "string" && isHexString(v) && v.length >= 10) return v;
  }
  for (const key of ["data", "error", "info", "cause", "receipt"]) {
    const found = findRevertData(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const WALLET: Record<string, Pick<ErrorExplanation, "title" | "explanation" | "fix">> = {
  ACTION_REJECTED: {
    title: "Signature rejected",
    explanation: "The signing request was declined, so no transaction was sent.",
    fix: "Approve the request in your wallet to continue.",
  },
  INSUFFICIENT_FUNDS: {
    title: "Not enough ETH",
    explanation: "The account cannot cover the payment plus the gas fee.",
    fix: "Use an account with more ETH, or lower the amount.",
  },
  NONCE_EXPIRED: {
    title: "Nonce already used",
    explanation: "A transaction with this nonce was already mined. This often happens after restarting the local node while the wallet remembers the old chain.",
    fix: "In MetaMask: Settings → Advanced → Clear activity tab data.",
  },
  REPLACEMENT_UNDERPRICED: {
    title: "Replacement fee too low",
    explanation: "A pending transaction with this nonce exists. To replace it, the new one must pay a higher fee.",
    fix: "Raise the fee by at least 10 %.",
  },
  UNPREDICTABLE_GAS_LIMIT: {
    title: "Would fail",
    explanation: "The node could not estimate gas, which usually means the transaction would revert.",
    fix: "Fix the problem shown above, or use \"Send anyway\" to watch it fail on chain.",
  },
  NETWORK_ERROR: {
    title: "Can't reach the node",
    explanation: "The JSON-RPC connection to the local node failed.",
    fix: "Start it with `npm run dev:node`.",
  },
};

/** Explains anything thrown while preparing, sending or simulating a transaction. */
export function explainError(err: unknown, ctx: ExplainContext = {}): ErrorExplanation {
  const data = findRevertData(err);
  if (data) return explainRevert(data, ctx);

  const code = (err as { code?: string } | null)?.code;
  if (code && WALLET[code]) {
    return base({ kind: code === "NETWORK_ERROR" ? "network" : "wallet", name: code, ...WALLET[code] });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied transaction/i.test(message)) {
    return base({ kind: "wallet", name: "ACTION_REJECTED", ...WALLET.ACTION_REJECTED! });
  }
  return base({ explanation: message.slice(0, 300) });
}
