import type { ApiTxDetail, ErrorExplanation } from "@dpp/shared";
import type { MarketFunction, Simulation } from "@/web3/market";

export type LifecycleState = "pending" | "mined" | "failed" | "replaced" | "dropped";

export type FlowStage =
  | "draft"       // prepared, nothing run yet
  | "simulating"  // asking the node what would happen
  | "simulated"   // the simulation succeeded
  | "simfail"     // the simulation says it would revert
  | "signing"     // waiting for the signature / for the node to accept
  | "pending"     // in the mempool
  | "mined"       // included in a block, executed successfully
  | "failed"      // included in a block but reverted
  | "replaced"    // another transaction took its nonce
  | "dropped"     // removed from the mempool
  | "rejected"    // the user declined to sign
  | "error";      // could not be sent for another reason

export const FINAL_STAGES: FlowStage[] = ["mined", "failed", "replaced", "dropped", "rejected", "error", "simfail"];

export interface FlowTx {
  id: string;
  fn: MarketFunction;
  label: string;
  /** Raw contract arguments. */
  args: unknown[];
  /** The same arguments, named and formatted for display. */
  shownArgs: Record<string, string>;
  value: bigint | undefined;
  /** Whether this call is expected to append a ledger record. */
  writesRecord: boolean;
  from: string;
  fromRole: string | null;
  /** ABI-encoded call data and its 4-byte function selector. */
  calldata: string;
  selector: string;
  signature: string;

  stage: FlowStage;
  simulation: Simulation | null;
  /** Sent although the simulation said it would fail. */
  forced: boolean;
  hash: string | null;
  nonce: number | null;
  /** The backend's view, refreshed as the transaction moves. */
  backend: ApiTxDetail | null;
  error: ErrorExplanation | null;
  /** Rebuilt from the backend to look at a past transaction; it was not drafted or simulated here. */
  replay?: boolean;
  /** When each stage was entered (ms since epoch). */
  history: { stage: FlowStage; at: number }[];
}
