require("@nomicfoundation/hardhat-toolbox");

// `DEV_NODE=1` marks the long-running local node used by the visualizer
// (`npm run dev:node`). It changes two things, and only for that node:
//
//  * throwOnTransactionFailures=false: a transaction that reverts is *mined*
//    with status 0 and returns a hash, like on a real network. By default
//    Hardhat throws instead, so the sender never gets a hash and a "failed
//    transaction" could never be shown. The test suite relies on the default
//    (several tests assume a revert throws), so this must not be global.
//  * automine stays on, but can be switched off at runtime (evm_setAutomine)
//    for the step-by-step mining mode.
const devNode = process.env.DEV_NODE === "1";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // storageLayout lets the tooling find exact storage slots instead of guessing.
      outputSelection: { "*": { "*": ["storageLayout"] } },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      ...(devNode ? { throwOnTransactionFailures: false, mining: { auto: true, interval: 0 } } : {}),
    },
    localhost: { url: process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545" },
  },
};
