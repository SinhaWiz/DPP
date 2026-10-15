import { findRevertData } from "@dpp/shared";
import type { Rpc } from "../chain/rpc";
import { type RawTx, toHexQuantity } from "./rawTypes";

export interface RevertInfo {
  /** ABI-encoded revert bytes, or null if the call did not revert / returned nothing. */
  data: string | null;
  /** True when the data came from replaying the call instead of tracing the real execution. */
  approx: boolean;
}

export interface SstoreStep {
  slot: string;
  after: string;
  gasCost: number;
}

interface TraceStep {
  op: string;
  depth: number;
  gasCost: number;
  stack?: string[];
}

interface TraceResult {
  failed: boolean;
  returnValue: string;
  structLogs: TraceStep[];
}

const pad32 = (hex: string) => "0x" + hex.replace(/^0x/, "").padStart(64, "0");
const prefixed = (hex: string) => (hex.startsWith("0x") ? hex : "0x" + hex);

/**
 * Explains what happened inside a transaction by asking the node to trace it. Nodes that do not
 * offer `debug_traceTransaction` (most hosted RPCs) fall back to re-running the call.
 */
export class TraceReader {
  private traceSupported = true;

  constructor(private readonly rpc: Rpc) {}

  get tracing(): boolean {
    return this.traceSupported;
  }

  private async trace(hash: string, options: object): Promise<TraceResult | null> {
    if (!this.traceSupported) return null;
    try {
      return await this.rpc.send<TraceResult>("debug_traceTransaction", [hash, options]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/not (found|supported|available)|unsupported|unknown method|does not exist|disabled|method/i.test(message)) {
        this.traceSupported = false;
      }
      return null;
    }
  }

  /** Revert bytes of a failed transaction. */
  async revertFor(tx: RawTx, blockNumber: number): Promise<RevertInfo> {
    const trace = await this.trace(tx.hash, { disableMemory: true, disableStorage: true, disableStack: true });
    if (trace?.failed && trace.returnValue) return { data: prefixed(trace.returnValue), approx: false };
    if (trace && !trace.returnValue) return { data: null, approx: false }; // reverted with no reason

    // No trace available: re-run the call just before the block. Close, but not exact when
    // earlier transactions in the same block changed the state.
    try {
      await this.rpc.send("eth_call", [
        { from: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas },
        toHexQuantity(Math.max(0, blockNumber - 1)),
      ]);
      return { data: null, approx: true }; // it succeeded when replayed
    } catch (e) {
      return { data: findRevertData(e), approx: true };
    }
  }

  /**
   * Every storage write the transaction's own contract made, in order. Only the top-level frame
   * (depth 1) is considered, which is the market when the transaction is addressed to it.
   */
  async storageWrites(hash: string): Promise<SstoreStep[] | null> {
    const trace = await this.trace(hash, { disableMemory: true, disableStorage: true });
    if (!trace) return null;
    const out: SstoreStep[] = [];
    for (const step of trace.structLogs) {
      if (step.op !== "SSTORE" || step.depth !== 1 || !step.stack || step.stack.length < 2) continue;
      const key = step.stack[step.stack.length - 1]!;
      const value = step.stack[step.stack.length - 2]!;
      out.push({ slot: pad32(key), after: pad32(value), gasCost: step.gasCost });
    }
    return out;
  }
}
