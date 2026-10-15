/** Domain types shared by the backend and the frontend. Amounts and indexes are always `bigint`. */

export const Action = {
  Registered: 0,
  Listed: 1,
  Delisted: 2,
  Sold: 3,
  Reserved: 4,
  Revoked: 5,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const ACTIONS = Object.values(Action) as Action[];

export const RevocationReason = { BuyerCancelled: 0, SellerRejected: 1, Expired: 2 } as const;
export type RevocationReason = (typeof RevocationReason)[keyof typeof RevocationReason];

/** `prevHash` of the first record. */
export const GENESIS_HASH = "0x" + "00".repeat(32);
export const ZERO_ADDRESS = "0x" + "00".repeat(20);

/** One block of the ledger chain (the contract's `Record`; renamed to avoid clashing with TS's `Record`). */
export interface LedgerRecord {
  index: bigint;
  timestamp: bigint;
  productId: bigint;
  action: Action;
  actor: string;
  counterparty: string;
  price: bigint;
  prevHash: string;
  hash: string;
}

export interface Product {
  id: bigint;
  name: string;
  owner: string;
  price: bigint;
}

export interface Reservation {
  buyer: string;
  amount: bigint;
  expiresAt: bigint;
}

/** What a `RecordAppended` log claims about a record: the independent witness. */
export interface EventWitness {
  index: bigint;
  productId: bigint;
  action: Action;
  actor: string;
  prevHash: string;
  hash: string;
}

/** Fields of an ethers `Result` / plain object that describe a record. */
type RecordLike = {
  index: bigint | number | string;
  timestamp: bigint | number | string;
  productId: bigint | number | string;
  action: bigint | number;
  actor: string;
  counterparty: string;
  price: bigint | number | string;
  prevHash: string;
  hash: string;
};

/** Normalizes an ethers `Result`, a JSON fixture (string numbers) or a plain object into a `LedgerRecord`. */
export function toLedgerRecord(r: RecordLike): LedgerRecord {
  return {
    index: BigInt(r.index),
    timestamp: BigInt(r.timestamp),
    productId: BigInt(r.productId),
    action: Number(r.action) as Action,
    actor: r.actor,
    counterparty: r.counterparty,
    price: BigInt(r.price),
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

export function toProduct(p: { id: bigint | number | string; name: string; owner: string; price: bigint | number | string }): Product {
  return { id: BigInt(p.id), name: p.name, owner: p.owner, price: BigInt(p.price) };
}

export function toReservation(r: { buyer: string; amount: bigint | number | string; expiresAt: bigint | number | string }): Reservation {
  return { buyer: r.buyer, amount: BigInt(r.amount), expiresAt: BigInt(r.expiresAt) };
}
