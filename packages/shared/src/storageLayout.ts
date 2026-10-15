import { AbiCoder, getAddress, keccak256, toBeHex, zeroPadValue } from "ethers";
import { storageLayout as compiled } from "./abi";
import type { LedgerRecord } from "./types";

/**
 * Where contract state lives in EVM storage. Everything here derives from the compiler's
 * storage layout (`contract.json`), so it follows the contract if variables are added.
 *
 * `_ledger` is a dynamic array of 8-slot structs:
 *   slot p            holds the array LENGTH
 *   keccak256(p) + 8·i + k   holds member k of element i
 *
 * Members of a Record (see the layout):
 *   0 index · 1 timestamp · 2 productId · 3 action (1 byte) + actor (20 bytes), packed
 *   4 counterparty · 5 price · 6 prevHash · 7 hash
 */

export type RecordMember =
  | "index" | "timestamp" | "productId" | "action" | "actor" | "counterparty" | "price" | "prevHash" | "hash";

export const RECORD_MEMBERS: RecordMember[] = [
  "index", "timestamp", "productId", "action", "actor", "counterparty", "price", "prevHash", "hash",
];

/** Size in bytes of each member inside its slot. */
export const MEMBER_BYTES: Record<RecordMember, number> = {
  index: 32, timestamp: 32, productId: 32, action: 1, actor: 20, counterparty: 32, price: 32, prevHash: 32, hash: 32,
};

export type Layout = typeof compiled;

const coder = AbiCoder.defaultAbiCoder();
const MASK_256 = (1n << 256n) - 1n;

/** 32-byte hex (0x + 64 chars) for a slot number or value. */
export const word = (v: bigint | number): string => zeroPadValue(toBeHex(BigInt(v)), 32);

export function variableSlot(name: string, layout: Layout = compiled): bigint {
  const v = layout.variables[name];
  if (!v) throw new Error(`No storage variable named ${name}`);
  return BigInt(v.slot);
}

/** Slot that stores `ledgerLength()`. */
export const ledgerLengthSlot = (layout: Layout = compiled): bigint => variableSlot("_ledger", layout);

/** Slot of element 0, member 0: keccak256(abi.encode(slot)). */
export function ledgerBaseSlot(layout: Layout = compiled): bigint {
  return BigInt(keccak256(word(ledgerLengthSlot(layout))));
}

function member(name: RecordMember, layout: Layout) {
  const m = layout.record.members.find((x) => x.name === name);
  if (!m) throw new Error(`Record has no member ${name}`);
  return m;
}

/** Absolute slot holding `name` of ledger element `index`. */
export function recordSlot(index: bigint | number, name: RecordMember, layout: Layout = compiled): bigint {
  return ledgerBaseSlot(layout) + BigInt(index) * BigInt(layout.record.slots) + BigInt(member(name, layout).slot);
}

/** Slot of a `mapping(key => …)` entry: keccak256(abi.encode(key, mappingSlot)). */
export function mappingSlot(key: bigint | string, mapping: bigint | number, keyType: "uint256" | "address"): bigint {
  return BigInt(keccak256(coder.encode([keyType, "uint256"], [key, mapping])));
}

// ───────────────────── Packed-slot helpers ─────────────────────

/** Reads `bytes` bytes at byte `offset` (from the least-significant end) of a 32-byte slot value. */
export function readPacked(slotValue: bigint, offset: number, bytes: number): bigint {
  return (slotValue >> BigInt(offset * 8)) & ((1n << BigInt(bytes * 8)) - 1n);
}

/** Returns `slotValue` with the bytes at `offset` replaced, leaving every other bit untouched. */
export function writePacked(slotValue: bigint, offset: number, bytes: number, value: bigint): bigint {
  const mask = ((1n << BigInt(bytes * 8)) - 1n) << BigInt(offset * 8);
  return ((slotValue & ~mask) | ((value << BigInt(offset * 8)) & mask)) & MASK_256;
}

/** Splits slot 3 of a record into its action and actor. */
export function decodeActionActor(slotValue: bigint, layout: Layout = compiled): { action: number; actor: string } {
  const a = member("action", layout);
  const b = member("actor", layout);
  return {
    action: Number(readPacked(slotValue, a.offset, MEMBER_BYTES.action)),
    actor: getAddress(zeroPadValue(toBeHex(readPacked(slotValue, b.offset, MEMBER_BYTES.actor)), 20)),
  };
}

// ───────────────────── Whole-record views ─────────────────────

export interface SlotView {
  /** Absolute storage slot. */
  slot: bigint;
  slotHex: string;
  /** Member offset within the record, 0..7. */
  position: number;
  /** The 32-byte value the slot holds. */
  value: string;
  /** Which fields live in this slot (two for the packed slot). */
  members: { name: RecordMember; offset: number; bytes: number; decoded: string }[];
}

function memberValue(r: LedgerRecord, name: RecordMember): bigint {
  switch (name) {
    case "index": return r.index;
    case "timestamp": return r.timestamp;
    case "productId": return r.productId;
    case "action": return BigInt(r.action);
    case "actor": return BigInt(r.actor);
    case "counterparty": return BigInt(r.counterparty);
    case "price": return r.price;
    case "prevHash": return BigInt(r.prevHash);
    case "hash": return BigInt(r.hash);
  }
}

function decoded(r: LedgerRecord, name: RecordMember): string {
  switch (name) {
    case "action": return String(r.action);
    case "actor": return r.actor;
    case "counterparty": return r.counterparty;
    case "prevHash": return r.prevHash;
    case "hash": return r.hash;
    default: return String(memberValue(r, name));
  }
}

/** The raw 32-byte value each of a record's slots holds, with the packed slot assembled. */
export function recordSlotViews(r: LedgerRecord, layout: Layout = compiled): SlotView[] {
  const views: SlotView[] = [];
  for (let position = 0; position < layout.record.slots; position++) {
    const here = RECORD_MEMBERS.filter((n) => member(n, layout).slot === position);
    let value = 0n;
    for (const name of here) value = writePacked(value, member(name, layout).offset, MEMBER_BYTES[name], memberValue(r, name));
    const slot = recordSlot(r.index, here[0] ?? "index", layout) - BigInt(member(here[0] ?? "index", layout).slot) + BigInt(position);
    views.push({
      slot,
      slotHex: word(slot),
      position,
      value: word(value),
      members: here.map((name) => ({
        name, offset: member(name, layout).offset, bytes: MEMBER_BYTES[name], decoded: decoded(r, name),
      })),
    });
  }
  return views;
}

/** A single storage write: where to put which 32-byte value. */
export interface SlotWrite {
  slot: bigint;
  value: bigint;
}

/**
 * Builds the slot write that sets `name` of record `index` to `value`.
 * `currentSlotValue` is the slot's present content, needed to keep neighbours in the packed slot.
 */
export function buildFieldWrite(
  index: bigint | number,
  name: RecordMember,
  value: bigint,
  currentSlotValue: bigint,
  layout: Layout = compiled,
): SlotWrite {
  const m = member(name, layout);
  const next = writePacked(currentSlotValue, m.offset, MEMBER_BYTES[name], value);
  return { slot: recordSlot(index, name, layout), value: next };
}

/** Value to store for a member given an address/hash/number given as hex or bigint. */
export function toMemberValue(name: RecordMember, v: bigint | number | string): bigint {
  const n = typeof v === "string" ? BigInt(v) : BigInt(v);
  const max = 1n << BigInt(MEMBER_BYTES[name] * 8);
  if (n < 0n || n >= max) throw new Error(`${name} does not fit in ${MEMBER_BYTES[name]} bytes`);
  return n;
}
