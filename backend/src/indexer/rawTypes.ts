/** Shapes of the JSON-RPC objects the indexer reads (hex strings, as the node returns them). */
export interface RawTx {
  hash: string;
  from: string;
  to: string | null;
  nonce: string;
  value: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  input: string;
  transactionIndex?: string;
  blockNumber?: string | null;
}

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
}

export interface RawReceipt {
  transactionHash: string;
  status: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: RawLog[];
}

export interface RawBlock {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  transactions: RawTx[];
}

export const toNumber = (hex: string | undefined | null): number => (hex ? Number(BigInt(hex)) : 0);
export const toBig = (hex: string | undefined | null): bigint => (hex ? BigInt(hex) : 0n);
export const toHexQuantity = (n: number | bigint): string => "0x" + BigInt(n).toString(16);
