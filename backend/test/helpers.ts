import { Contract, parseEther } from "ethers";
import { deployContracts, makeDeployment, startDevNode, type DevNode, type Deployed } from "@dpp/shared/testing";
import type { Deployment } from "@dpp/shared";
import { Bus } from "../src/bus";
import { createRpc, type Rpc } from "../src/chain/rpc";
import { Repo } from "../src/db/repo";
import { Indexer } from "../src/indexer/indexer";
import { silentLogger } from "../src/logger";

export interface Harness {
  node: DevNode;
  deployed: Deployed;
  deployment: Deployment;
  rpc: Rpc;
  repo: Repo;
  bus: Bus;
  indexer: Indexer;
  /** Calls a market function as role `signer` (0 = Manufacturer … 4 = Outsider). */
  call: (signer: number, fn: string, ...args: unknown[]) => Promise<void>;
  /** Sends a call that is expected to revert, with an explicit gas limit so the node mines it. Returns the tx hash. */
  callFailing: (signer: number, fn: string, ...args: unknown[]) => Promise<string>;
  stop: () => Promise<void>;
}

/** Starts a real dev node, deploys the contracts and wires an indexer over an in-memory database. */
export async function startHarness(opts: { traceStorage?: boolean } = {}): Promise<Harness> {
  const node = await startDevNode();
  const deployed = await deployContracts(node.provider);
  const deployment = await makeDeployment(node.provider, deployed);
  const rpc = createRpc(node.url);
  const repo = Repo.open(":memory:");
  const bus = new Bus();
  const indexer = new Indexer({
    rpc, repo, bus, log: silentLogger, getDeployment: () => deployment, pollMs: 50,
    traceStorage: opts.traceStorage ?? true,
  });
  const market = deployed.market;

  const send = async (signer: number, fn: string, args: unknown[], overrides: object = {}) =>
    (market.connect(deployed.signers[signer]!) as Contract).getFunction(fn)(...args, overrides);

  return {
    node, deployed, deployment, rpc, repo, bus, indexer,
    call: async (signer, fn, ...args) => {
      const last = args[args.length - 1];
      const hasOverrides = typeof last === "object" && last !== null && !Array.isArray(last);
      const tx = await send(signer, fn, hasOverrides ? args.slice(0, -1) : args, hasOverrides ? (last as object) : {});
      await tx.wait();
    },
    callFailing: async (signer, fn, ...args) => {
      const last = args[args.length - 1];
      const hasOverrides = typeof last === "object" && last !== null && !Array.isArray(last);
      const tx = await send(signer, fn, hasOverrides ? args.slice(0, -1) : args, { gasLimit: 400_000, ...(hasOverrides ? (last as object) : {}) });
      await tx.wait().catch(() => undefined);
      return tx.hash;
    },
    stop: async () => {
      await indexer.stop();
      rpc.destroy();
      repo.close();
      await node.stop();
    },
  };
}

export const eth = (v: string) => parseEther(v);
