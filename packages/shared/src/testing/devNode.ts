/**
 * Test helper (Node only): starts a real `hardhat node` with DEV_NODE=1 on a free port and deploys
 * the market contract to it, so tests can run against actual EVM storage, mining and logs.
 * Not exported from the package index; import it from "@dpp/shared/testing".
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { marketAbi, storageLayout } from "../abi";
import type { Deployment } from "../deployment";
import { ContractFactory, JsonRpcProvider, NonceManager, type Contract, type JsonRpcSigner } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../../..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => res(port));
    });
  });
}

function artifact(name: string, file: string) {
  const path = resolve(REPO_ROOT, "artifacts/contracts", file, `${name}.json`);
  if (!existsSync(path)) execFileSync("npx", ["hardhat", "compile", "--quiet"], { cwd: REPO_ROOT, stdio: "ignore" });
  return JSON.parse(readFileSync(path, "utf8")) as { abi: unknown[]; bytecode: string };
}

export interface DevNode {
  url: string;
  port: number;
  provider: JsonRpcProvider;
  stop: () => Promise<void>;
}

export async function startDevNode(): Promise<DevNode> {
  const port = await freePort();
  const child: ChildProcess = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, DEV_NODE: "1" },
    stdio: "ignore",
    detached: true, // own process group, so the whole npx → hardhat tree can be killed
  });

  const url = `http://127.0.0.1:${port}`;
  // cacheTimeout -1: no read cache, because tests read storage right after writing it.
  const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await provider.send("eth_chainId", []);
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        throw new Error("hardhat node did not start in time");
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return {
    url,
    port,
    provider,
    stop: async () => {
      provider.destroy();
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    },
  };
}

export interface Deployed {
  market: Contract;
  rejecter: Contract;
  signers: JsonRpcSigner[];
}

/** Deploys BuySellTraceability and EtherRejecter using the first dev account. */
export async function deployContracts(provider: JsonRpcProvider): Promise<Deployed> {
  const signers = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
  const m = artifact("BuySellTraceability", "BuySellTraceability.sol");
  const r = artifact("EtherRejecter", "test/EtherRejecter.sol");
  const market = await (await new ContractFactory(m.abi as never, m.bytecode, signers[0]).deploy()).waitForDeployment();
  const rejecter = await (await new ContractFactory(r.abi as never, r.bytecode, signers[0]).deploy()).waitForDeployment();
  return { market: market as Contract, rejecter: rejecter as Contract, signers };
}

export { NonceManager };

/** Builds the same object `npm run dev:deploy` writes to deployment.json, for contracts just deployed in a test. */
export async function makeDeployment(provider: JsonRpcProvider, d: Deployed): Promise<Deployment> {
  const genesis = await provider.getBlock(0);
  const marketAddress = await d.market.getAddress();
  const rejecterAddress = await d.rejecter.getAddress();
  const receipt = await d.market.deploymentTransaction()!.wait();
  const names = ["Manufacturer", "Distributor", "Retailer", "Customer", "Outsider"];
  const roles = await Promise.all(
    d.signers.map(async (s, index) => ({ index, name: names[index]!, description: "", address: await s.getAddress() })),
  );
  roles.push({ index: -1, name: "Broken Wallet", description: "", address: rejecterAddress });
  return {
    chainId: Number((await provider.getNetwork()).chainId),
    sessionId: genesis!.hash!,
    deployedAt: new Date().toISOString(),
    deployBlock: receipt!.blockNumber,
    contracts: {
      market: { address: marketAddress, abi: marketAbi },
      rejecter: { address: rejecterAddress, abi: d.rejecter.interface.fragments.map((f) => JSON.parse(f.format("json"))) },
    },
    storage: storageLayout,
    roles,
  };
}
