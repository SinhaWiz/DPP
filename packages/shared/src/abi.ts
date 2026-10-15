import { ErrorFragment, Interface, type InterfaceAbi } from "ethers";
import contract from "./contract.json";

/** ABI of BuySellTraceability, committed so no deployment is needed to decode data. */
export const marketAbi = contract.abi as InterfaceAbi;
export const marketInterface = new Interface(marketAbi);

/** Compiler storage layout of BuySellTraceability (variables and the Record struct). */
export const storageLayout = contract.storage as {
  variables: Record<string, { slot: number; offset: number; type: string }>;
  record: { slots: number; members: { name: string; slot: number; offset: number }[] };
};

/** Name of every custom error in the ABI. */
export const customErrorNames: string[] = marketInterface.fragments
  .filter((f): f is ErrorFragment => f instanceof ErrorFragment)
  .map((f) => f.name);
