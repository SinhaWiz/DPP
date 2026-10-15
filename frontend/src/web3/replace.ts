import type { Signer } from "ethers";

/** A replacement must pay more than the original or the node refuses it; doubling (plus one wei) always clears the bar. */
export function bumpFee(fee: string | null, fallback = 1_000_000_000n): bigint {
  return (fee ? BigInt(fee) : fallback) * 2n + 1n;
}

/**
 * Cancels a pending transaction from the user's own wallet: send a 0-ETH transfer to yourself with the
 * same nonce and a higher fee. Whichever of the two is mined first wins the nonce; with the higher fee it
 * is the cancel, and the original can never run.
 */
export async function cancelWithWallet(
  signer: Signer,
  pending: { from: string; nonce: number; maxFee: string | null; maxPriorityFee: string | null },
): Promise<string> {
  const sent = await signer.sendTransaction({
    to: pending.from,
    value: 0n,
    nonce: pending.nonce,
    gasLimit: 21_000n,
    maxFeePerGas: bumpFee(pending.maxFee),
    maxPriorityFeePerGas: bumpFee(pending.maxPriorityFee, 500_000_000n),
  });
  return sent.hash;
}
