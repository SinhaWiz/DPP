import { defineConfig } from "vitest/config";

// Many test files start a real Hardhat node (some start two). Running them all at once saturates the CPU
// and makes tests time out for no good reason, so cap how many files run in parallel.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 90_000,
    pool: "forks",
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
