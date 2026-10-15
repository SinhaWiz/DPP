// Transaction-level revocation: with mining paused, one pending transaction is replaced by another
// with the same nonce and a higher fee, and another is dropped. Neither is ever mined.
const { ethers } = require("hardhat");

module.exports = {
  name: "pendingReplacement",
  description: "A pending transaction is replaced, another is dropped; neither reaches the ledger.",
  async run(ctx) {
    const { log, as, retailer, customer } = ctx;
    const provider = ethers.provider;

    await provider.send("evm_setAutomine", [false]);
    try {
      log("▶ Mining paused. Retailer sends a registration, then replaces it with a 0-ETH self-transfer");
      const nonce = await provider.getTransactionCount(retailer.address, "pending");
      const original = await as(retailer).registerProduct("Never-mined item", {
        nonce, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
      });
      const replacement = await retailer.sendTransaction({
        to: retailer.address, value: 0, nonce,
        maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n,
      });

      log("▶ Customer sends a registration and it is dropped from the pool");
      const dropped = await as(customer).registerProduct("Dropped item");
      await provider.send("hardhat_dropTransaction", [dropped.hash]);

      await provider.send("evm_mine", []);
      const mined = async (h) => (await provider.getTransactionReceipt(h)) !== null;
      const result = {
        original: original.hash, replacement: replacement.hash, dropped: dropped.hash,
        originalMined: await mined(original.hash),
        replacementMined: await mined(replacement.hash),
        droppedMined: await mined(dropped.hash),
      };
      log(`  original mined: ${result.originalMined}, replacement mined: ${result.replacementMined}, dropped mined: ${result.droppedMined}`);
      return result;
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }
  },
};
