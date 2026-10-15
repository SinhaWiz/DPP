import type { FastifyInstance } from "fastify";
import { Contract, parseEther } from "ethers";
import { deployContracts, makeDeployment, startDevNode, type DevNode, type Deployed } from "@dpp/shared/testing";
import type { Deployment } from "@dpp/shared";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createServices, type Services } from "../src/services";

export interface Harness extends Pick<Services, "rpc" | "repo" | "bus" | "indexer" | "verification" | "watcher" | "config"> {
  node: DevNode;
  deployed: Deployed;
  deployment: Deployment;
  services: Services;
  /** The HTTP app, built on first use. */
  app: () => Promise<FastifyInstance>;
  /** POST a JSON body and parse the JSON response. */
  post: <T = unknown>(url: string, payload?: unknown) => Promise<{ status: number; body: T }>;
  /** GET a path and parse the JSON body. */
  get: <T = unknown>(url: string) => Promise<{ status: number; body: T }>;
  /** Calls a market function as role `signer` (0 = Manufacturer … 4 = Outsider) and waits for it. */
  call: (signer: number, fn: string, ...args: unknown[]) => Promise<void>;
  /** Sends a call that is expected to revert, with an explicit gas limit so the node mines it. Returns the tx hash. */
  callFailing: (signer: number, fn: string, ...args: unknown[]) => Promise<string>;
  stop: () => Promise<void>;
}

/** Starts a real dev node, deploys the contracts and wires the same services the server uses, over an in-memory database. */
export async function startHarness(opts: { traceStorage?: boolean; labGraceMs?: number } = {}): Promise<Harness> {
  const node = await startDevNode();
  const deployed = await deployContracts(node.provider);
  const deployment = await makeDeployment(node.provider, deployed);
  const config = loadConfig({}, {
    RPC_URL: node.url, DB_PATH: ":memory:", LOG_LEVEL: "silent", POLL_MS: 50, TRACE_STORAGE: opts.traceStorage ?? true, LAB_GRACE_MS: opts.labGraceMs ?? 150,
  });
  const services = createServices(config, { getDeployment: () => deployment });
  const market = deployed.market;

  let appInstance: FastifyInstance | null = null;
  const app = async () => (appInstance ??= await buildApp(services));

  const send = async (signer: number, fn: string, args: unknown[], overrides: object = {}) =>
    (market.connect(deployed.signers[signer]!) as Contract).getFunction(fn)(...args, overrides);
  const split = (args: unknown[]) => {
    const last = args[args.length - 1];
    const hasOverrides = typeof last === "object" && last !== null && !Array.isArray(last);
    return { args: hasOverrides ? args.slice(0, -1) : args, overrides: hasOverrides ? (last as object) : {} };
  };

  return {
    node, deployed, deployment, services, config,
    rpc: services.rpc, repo: services.repo, bus: services.bus, indexer: services.indexer,
    verification: services.verification, watcher: services.watcher,
    app,
    get: async (url) => {
      const res = await (await app()).inject({ method: "GET", url });
      return { status: res.statusCode, body: res.json() };
    },
    post: async (url, payload) => {
      const res = await (await app()).inject({ method: "POST", url, payload: payload as never });
      return { status: res.statusCode, body: res.json() };
    },
    call: async (signer, fn, ...rest) => {
      const { args, overrides } = split(rest);
      await (await send(signer, fn, args, overrides)).wait();
    },
    callFailing: async (signer, fn, ...rest) => {
      const { args, overrides } = split(rest);
      const tx = await send(signer, fn, args, { gasLimit: 400_000, ...overrides });
      await tx.wait().catch(() => undefined);
      return tx.hash;
    },
    stop: async () => {
      await appInstance?.close();
      await services.indexer.stop();
      services.rpc.destroy();
      services.repo.close();
      await node.stop();
    },
  };
}

export const eth = (v: string) => parseEther(v);
