// Helpers that rewrite a ledger record directly in contract storage, simulating
// an attacker. Possible only on a local dev network (hardhat_setStorageAt).
const { ethers } = require("hardhat");

// Record layout in storage (8 slots per record):
//   0 index | 1 timestamp | 2 productId | 3 action (uint8) + actor (address) packed
//   4 counterparty | 5 price | 6 prevHash | 7 hash
const RECORD_SLOTS = 8n;
const FIELD = { index: 0n, timestamp: 1n, productId: 2n, actionActor: 3n, counterparty: 4n, price: 5n, prevHash: 6n, hash: 7n };

// Locate the ledger array's slot by probing: its length slot equals ledgerLength().
async function findLedgerSlot(c) {
  const addr = await c.getAddress();
  const len = await c.ledgerLength();
  for (let s = 0; s < 10; s++) {
    const v = await ethers.provider.getStorage(addr, s);
    if (BigInt(v) === len) return s;
  }
  throw new Error("ledger slot not found");
}

async function recordSlot(c, recordIndex, field) {
  const slot = await findLedgerSlot(c);
  const base = BigInt(ethers.keccak256(ethers.toBeHex(slot, 32)));
  return base + BigInt(recordIndex) * RECORD_SLOTS + FIELD[field];
}

async function writeSlot(c, slot, value32) {
  await ethers.provider.send("hardhat_setStorageAt", [
    await c.getAddress(), ethers.toBeHex(slot, 32), ethers.zeroPadValue(ethers.toBeHex(value32), 32),
  ]);
}

/** Overwrites one 32-byte field of a stored record. */
async function tamperField(c, recordIndex, field, value) {
  await writeSlot(c, await recordSlot(c, recordIndex, field), value);
}

/** Rewrites a record's price to `value` (default 999 wei). */
function tamperWithPrice(c, recordIndex, value = 999n) {
  return tamperField(c, recordIndex, "price", value);
}

/** Overwrites a record's stored hash. */
function tamperWithHash(c, recordIndex, hash) {
  return tamperField(c, recordIndex, "hash", hash);
}

/** Recomputes a record's hash from its current stored fields, as the contract does. */
async function recomputeHash(c, recordIndex) {
  const r = await c.getRecord(recordIndex);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint8", "address", "address", "uint256", "bytes32"],
      [r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash]
    )
  );
}

module.exports = { findLedgerSlot, recordSlot, writeSlot, tamperField, tamperWithPrice, tamperWithHash, recomputeHash };
