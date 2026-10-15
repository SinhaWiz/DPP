import { Interface, type InterfaceAbi, type Result, type ParamType } from "ethers";
import type { Deployment } from "@dpp/shared";
import type { RawLog } from "./rawTypes";

export interface Decoder {
  market: Interface;
  rejecter: Interface;
  marketAddress: string;
  rejecterAddress: string;
}

export function makeDecoder(d: Deployment): Decoder {
  return {
    market: new Interface(d.contracts.market.abi as InterfaceAbi),
    rejecter: new Interface(d.contracts.rejecter.abi as InterfaceAbi),
    marketAddress: d.contracts.market.address,
    rejecterAddress: d.contracts.rejecter.address,
  };
}

const sameAddress = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** One value as a display string: numbers in decimal, everything else as is. */
export function formatValue(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v) || (typeof v === "object" && v !== null && "toObject" in v)) {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  }
  return String(v);
}

/** Pairs decoded values with the parameter names of their fragment. */
export function formatArgs(inputs: readonly ParamType[], values: Result): Record<string, string> {
  const out: Record<string, string> = {};
  inputs.forEach((input, i) => { out[input.name || `arg${i}`] = formatValue(values[i]); });
  return out;
}

export interface DecodedCall {
  contract: "market" | "rejecter";
  functionName: string;
  args: Record<string, string>;
}

/** Decodes calldata sent to the market or the rejecter contract; null for anything else. */
export function decodeCall(dec: Decoder, to: string | null, input: string, value: bigint): DecodedCall | null {
  const which = sameAddress(to, dec.marketAddress) ? "market" : sameAddress(to, dec.rejecterAddress) ? "rejecter" : null;
  if (!which) return null;
  const iface = which === "market" ? dec.market : dec.rejecter;
  try {
    const parsed = iface.parseTransaction({ data: input, value });
    if (!parsed) return null;
    return { contract: which, functionName: parsed.name, args: formatArgs(parsed.fragment.inputs, parsed.args) };
  } catch {
    return null;
  }
}

export interface DecodedLog {
  name: string;
  args: Record<string, string>;
}

/** Decodes a log emitted by the market contract; null for other emitters or unknown events. */
export function decodeLog(dec: Decoder, log: Pick<RawLog, "address" | "topics" | "data">): DecodedLog | null {
  if (!sameAddress(log.address, dec.marketAddress)) return null;
  try {
    const parsed = dec.market.parseLog({ topics: log.topics as string[], data: log.data });
    if (!parsed) return null;
    return { name: parsed.name, args: formatArgs(parsed.fragment.inputs, parsed.args) };
  } catch {
    return null;
  }
}

export { sameAddress };
