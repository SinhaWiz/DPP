import { Contract, type ContractTransactionResponse, type Signer } from "ethers";
import { explainError, marketAbi, type ErrorExplanation } from "@dpp/shared";

export type MarketFunction =
  | "registerProduct" | "listForSale" | "cancelListing" | "buy"
  | "reserve" | "confirmSale" | "revokeReservation" | "rejectReservation" | "expireReservation" | "withdraw";

/** Gas limit used for "send anyway": with one set, ethers skips estimateGas, which would refuse a call that will revert. */
export const FORCE_GAS_LIMIT = 400_000n;

export interface CallOptions {
  /** Wei to send (for buy and reserve). */
  value?: bigint;
  /** Skip the node's gas estimate so a failing call is still sent and mined. */
  force?: boolean;
}

export type Simulation =
  | { ok: true }
  | { ok: false; error: ErrorExplanation };

export interface SentTransaction {
  hash: string;
  nonce: number;
  response: ContractTransactionResponse;
}

/** Typed access to the market contract for one signer. */
export class MarketClient {
  private readonly contract: Contract;

  constructor(address: string, readonly signer: Signer) {
    this.contract = new Contract(address, marketAbi, signer);
  }

  private overrides(o: CallOptions) {
    return { ...(o.value !== undefined ? { value: o.value } : {}), ...(o.force ? { gasLimit: FORCE_GAS_LIMIT } : {}) };
  }

  /**
   * Runs the call without sending it. If it would revert, says why in plain English. Nothing is
   * signed, nothing costs gas, and nothing reaches the chain.
   */
  async simulate(fn: MarketFunction, args: unknown[], o: CallOptions = {}): Promise<Simulation> {
    try {
      await this.contract.getFunction(fn).staticCall(...args, this.overrides({ value: o.value }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explainError(e) };
    }
  }

  /** Signs and sends. Resolves as soon as the node accepts it; use `.response.wait()` for the receipt. */
  async send(fn: MarketFunction, args: unknown[], o: CallOptions = {}): Promise<SentTransaction> {
    const response = (await this.contract.getFunction(fn)(...args, this.overrides(o))) as ContractTransactionResponse;
    return { hash: response.hash, nonce: response.nonce, response };
  }
}

/** Plain-English message for anything thrown while sending. */
export function describeSendError(e: unknown): ErrorExplanation {
  return explainError(e);
}
