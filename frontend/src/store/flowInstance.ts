import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { FlowState, TxFlow } from "./txFlow";

let instance: TxFlow | null = null;

export function setTxFlow(flow: TxFlow | null): void {
  instance?.dispose();
  instance = flow;
}

export function getTxFlow(): TxFlow {
  if (!instance) throw new Error("The transaction flow was not started");
  return instance;
}

/** Selects part of the transaction-flow state (shallow-compared, like useLive). */
export function useFlow<T>(selector: (s: FlowState) => T): T {
  return useStore(getTxFlow().store, useShallow(selector));
}
