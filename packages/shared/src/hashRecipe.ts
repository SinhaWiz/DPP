import { AbiCoder, keccak256 } from "ethers";
import type { LedgerRecord } from "./types";

/**
 * Exact port of `HashChainLedger._computeHash`:
 *
 *   keccak256(abi.encode(index, timestamp, productId, action, actor, counterparty, price, prevHash))
 *
 * Every field is a static type, so the encoding is eight consecutive 32-byte words.
 */
export const HASH_FIELDS = [
  { name: "index", type: "uint256" },
  { name: "timestamp", type: "uint256" },
  { name: "productId", type: "uint256" },
  { name: "action", type: "uint8" },
  { name: "actor", type: "address" },
  { name: "counterparty", type: "address" },
  { name: "price", type: "uint256" },
  { name: "prevHash", type: "bytes32" },
] as const;

export type HashInput = Pick<
  LedgerRecord,
  "index" | "timestamp" | "productId" | "action" | "actor" | "counterparty" | "price" | "prevHash"
>;

const coder = AbiCoder.defaultAbiCoder();

function values(r: HashInput): unknown[] {
  return [r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash];
}

/** Recomputes a record's hash from its other fields. */
export function computeHash(r: HashInput): string {
  return keccak256(coder.encode(HASH_FIELDS.map((f) => f.type), values(r)));
}

export interface HashFieldStep {
  name: string;
  solidityType: string;
  /** Human-readable value (decimal for numbers, as-is for addresses and hashes). */
  value: string;
  /** The field ABI-encoded alone: 32 bytes, 0x-prefixed. */
  word: string;
}

export interface HashExplanation {
  fields: HashFieldStep[];
  /** All words concatenated: 8 × 32 = 256 bytes. This is what gets hashed. */
  encoded: string;
  hash: string;
}

/** Breaks the hash computation into steps, for the "How is this hash made?" walkthrough. */
export function explainHash(r: HashInput): HashExplanation {
  const vals = values(r);
  const fields = HASH_FIELDS.map((f, i) => ({
    name: f.name,
    solidityType: f.type,
    value: String(vals[i]),
    word: coder.encode([f.type], [vals[i]]),
  }));
  const encoded = "0x" + fields.map((f) => f.word.slice(2)).join("");
  return { fields, encoded, hash: keccak256(encoded) };
}
