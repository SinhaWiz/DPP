// Shared setup for scenarios: who the actors are and how to log.
const { ethers } = require("hardhat");

/**
 * @param {{ market: any, rejecter?: any, signers: any[], log?: Function }} deps
 */
function makeContext({ market, rejecter, signers, log = console.log }) {
  const [manufacturer, distributor, retailer, customer, outsider] = signers;
  const eth = (v) => ethers.parseEther(String(v));
  return {
    market, rejecter, signers, log,
    manufacturer, distributor, retailer, customer, outsider,
    eth,
    as: (signer) => market.connect(signer),
    /** Product id the next `registerProduct` will receive. */
    nextProductId: async () => (await market.productCount()) + 1n,
  };
}

/** Sends a transaction and waits for it, tolerating one that reverts. Returns { hash, ok }. */
async function attempt(label, sendTx, log) {
  let hash;
  try {
    const tx = await sendTx();
    hash = tx.hash;
    await tx.wait();
    log?.(`  ✔ ${label}`);
    return { label, hash, ok: true };
  } catch (e) {
    // On a node that mines reverts (DEV_NODE) `hash` is set; on a plain in-memory network the send throws.
    log?.(`  ✘ ${label}${hash ? ` (mined with status 0, ${hash.slice(0, 10)}…)` : " (rejected before mining)"}`);
    return { label, hash, ok: false };
  }
}

// Explicit gas limit makes ethers skip `estimateGas`, which would otherwise refuse a transaction that will revert.
const FORCE = { gasLimit: 400_000 };

module.exports = { makeContext, attempt, FORCE };
