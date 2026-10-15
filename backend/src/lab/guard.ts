import type { Config } from "../config";

/** Chain id of the local Hardhat development network. */
export const DEV_CHAIN_ID = 31337;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export interface LabAvailability {
  available: boolean;
  /** Why it is unavailable, in words a learner can act on. */
  reason: string | null;
}

/**
 * The lab can rewrite contract storage and control mining, which is only safe on a throwaway local
 * chain that nobody else can reach: chain id 31337, and the API bound to a loopback address.
 */
export function labAvailability(config: Pick<Config, "HOST">, chainId: number | null): LabAvailability {
  if (chainId === null) return { available: false, reason: "The node is not reachable yet." };
  if (chainId !== DEV_CHAIN_ID) {
    return { available: false, reason: `Lab features are disabled on chain ${chainId}; they only run on the local dev chain (${DEV_CHAIN_ID}).` };
  }
  if (!LOOPBACK.has(config.HOST)) {
    return { available: false, reason: `Lab features are disabled because the API listens on ${config.HOST}; bind it to 127.0.0.1.` };
  }
  return { available: true, reason: null };
}
