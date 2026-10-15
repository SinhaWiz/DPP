import type { InterfaceAbi } from "ethers";
import type { Layout } from "./storageLayout";

/** What `npm run dev:deploy` writes to packages/shared/src/generated/deployment.json. */
export interface Deployment {
  chainId: number;
  /** Hash of block 0. A new value means the local node was restarted. */
  sessionId: string;
  deployedAt: string;
  deployBlock: number;
  contracts: {
    market: { address: string; abi: InterfaceAbi };
    rejecter: { address: string; abi: InterfaceAbi };
  };
  storage: Layout;
  roles: Role[];
}

export interface Role {
  /** Index of the Hardhat dev account, or -1 for the Broken Wallet contract. */
  index: number;
  name: string;
  description: string;
  address: string;
}

/** Validates the shape of a parsed deployment file and returns it typed. */
export function parseDeployment(json: unknown): Deployment {
  const d = json as Partial<Deployment> | null;
  const problems: string[] = [];
  if (!d || typeof d !== "object") throw new Error("deployment is not an object");
  if (typeof d.chainId !== "number") problems.push("chainId");
  if (typeof d.sessionId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(d.sessionId)) problems.push("sessionId");
  if (typeof d.deployBlock !== "number") problems.push("deployBlock");
  if (!d.contracts?.market?.address || !Array.isArray(d.contracts.market.abi)) problems.push("contracts.market");
  if (!d.contracts?.rejecter?.address || !Array.isArray(d.contracts.rejecter.abi)) problems.push("contracts.rejecter");
  if (!d.storage?.variables || !d.storage?.record) problems.push("storage");
  if (!Array.isArray(d.roles)) problems.push("roles");
  if (problems.length) throw new Error(`Invalid deployment file; missing or malformed: ${problems.join(", ")}`);
  return d as Deployment;
}

/** Name for an address: a role ("Retailer"), otherwise a shortened address. */
export function makeAddressLabeler(roles: Role[]): (address: string) => string {
  const byAddress = new Map(roles.map((r) => [r.address.toLowerCase(), r.name]));
  return (address) => byAddress.get(address.toLowerCase()) ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}
