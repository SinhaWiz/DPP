import { defineConfig } from "vitest/config";

// Many tests start a real Hardhat node (and some start two); give them room when files run in parallel.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 90_000 },
});
