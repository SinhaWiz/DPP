import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startDevNode, deployContracts, type DevNode, type Deployed } from "@dpp/shared/testing";
import { parseEther } from "ethers";
import { connectDemo, connectMetaMask, defaultRpcUrl, ensureChain, injectedWallet, watchWallet, WalletError, type Eip1193 } from "./wallet";
import { MarketClient, FORCE_GAS_LIMIT } from "./market";

describe("demo mode against a real node", () => {
  let node: DevNode;
  let deployed: Deployed;
  beforeAll(async () => {
    node = await startDevNode();
    deployed = await deployContracts(node.provider);
  }, 90_000);
  afterAll(async () => { await node.stop(); });

  it("acts as the chosen built-in account, without any key in the browser", async () => {
    const w0 = await connectDemo(node.url, 0);
    const w2 = await connectDemo(node.url, 2);
    expect(w0).toMatchObject({ kind: "demo", chainId: 31337 });
    expect(w0.address).toBe(await deployed.signers[0]!.getAddress());
    expect(w2.address).toBe(await deployed.signers[2]!.getAddress());
    expect(w0.address).not.toBe(w2.address);
  });

  it("explains an unreachable node", async () => {
    const err = await connectDemo("http://127.0.0.1:1", 0).catch((e) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.code).toBe("unreachable");
    expect(err.message).toContain("dev:node");
  }, 30_000);

  it("derives the proxied RPC address from the page origin", () => {
    expect(defaultRpcUrl({ origin: "http://127.0.0.1:5173" })).toBe("http://127.0.0.1:5173/rpc");
  });

  describe("MarketClient", () => {
    const address = () => deployed.market.getAddress();
    const price = parseEther("1");

    it("sends a real transaction as the selected account", async () => {
      const me = await connectDemo(node.url, 0);
      const market = new MarketClient(await address(), me.signer);
      const sent = await market.send("registerProduct", ["Laptop"]);
      const receipt = await sent.response.wait();
      expect(receipt!.status).toBe(1);
      expect(sent.hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect((await deployed.market.getFunction("getProduct")(1)).owner).toBe(me.address);
    });

    it("simulates a call that would succeed", async () => {
      const me = await connectDemo(node.url, 0);
      expect(await new MarketClient(await address(), me.signer).simulate("listForSale", [1, price])).toEqual({ ok: true });
    });

    it("explains why a call would fail, without sending anything", async () => {
      const outsider = await connectDemo(node.url, 4);
      const market = new MarketClient(await address(), outsider.signer);
      const before = await node.provider.getBlockNumber();

      const sim = await market.simulate("listForSale", [1, price]);
      expect(sim.ok).toBe(false);
      if (!sim.ok) {
        expect(sim.error.name).toBe("NotProductOwner");
        expect(sim.error.title).toBe("Not the owner");
        expect(sim.error.args.caller).toBe(outsider.address);
      }
      expect(await node.provider.getBlockNumber()).toBe(before); // nothing was mined
    });

    it("simulates payments, too", async () => {
      const buyer = await connectDemo(node.url, 1);
      const market = new MarketClient(await address(), buyer.signer);
      await (await new MarketClient(await address(), (await connectDemo(node.url, 0)).signer).send("listForSale", [1, price])).response.wait();

      const wrong = await market.simulate("buy", [1], { value: parseEther("0.5") });
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.error.explanation).toContain("expected 1.0 ETH, sent 0.5 ETH");
      expect(await market.simulate("buy", [1], { value: price })).toEqual({ ok: true });
    });

    it("'send anyway' mines a failing call and still returns a hash", async () => {
      const outsider = await connectDemo(node.url, 4);
      const market = new MarketClient(await address(), outsider.signer);
      const sent = await market.send("listForSale", [1, price], { force: true });
      expect(sent.hash).toMatch(/^0x[0-9a-f]{64}$/);
      const receipt = await sent.response.wait().catch((e) => e.receipt);
      expect(receipt.status).toBe(0);
      expect(FORCE_GAS_LIMIT).toBeGreaterThan(100_000n);
    });

    it("without 'force', the node refuses a call that would fail", async () => {
      const outsider = await connectDemo(node.url, 4);
      const market = new MarketClient(await address(), outsider.signer);
      await expect(market.send("listForSale", [1, price])).rejects.toBeDefined();
    });
  });
});

/** A scriptable EIP-1193 wallet. */
function fakeWallet(opts: { chainId?: number; accounts?: string[]; failOn?: Record<string, { code: number }>; unknownChain?: boolean } = {}) {
  let chainId = opts.chainId ?? 1;
  const calls: { method: string; params?: unknown }[] = [];
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  let added = false;
  const eth: Eip1193 = {
    async request({ method, params }) {
      calls.push({ method, params });
      const fail = opts.failOn?.[method];
      if (fail) throw Object.assign(new Error(`${method} failed`), { code: fail.code });
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return opts.accounts ?? ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
        case "eth_chainId": return "0x" + chainId.toString(16);
        case "net_version": return String(chainId);
        case "wallet_switchEthereumChain": {
          if (opts.unknownChain && !added) throw Object.assign(new Error("unrecognized chain"), { code: 4902 });
          chainId = Number(BigInt((params as [{ chainId: string }])[0].chainId));
          return null;
        }
        case "wallet_addEthereumChain": added = true; return null;
        default: throw new Error(`unexpected ${method}`);
      }
    },
    on: (e, h) => { (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(h); },
    removeListener: (e, h) => { listeners.get(e)?.delete(h); },
  };
  return { eth, calls, emit: (e: string, ...a: unknown[]) => listeners.get(e)?.forEach((h) => h(...a)), listeners, chain: () => chainId };
}

describe("MetaMask / EIP-1193", () => {
  it("connects, switches a wallet on another network to the local chain, and returns a signer", async () => {
    const w = fakeWallet({ chainId: 1 });
    const wallet = await connectMetaMask(w.eth, { chainId: 31337 });
    expect(wallet).toMatchObject({ kind: "metamask", chainId: 31337, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    expect(w.chain()).toBe(31337);
    expect(w.calls.map((c) => c.method)).toContain("wallet_switchEthereumChain");
    expect(w.calls.map((c) => c.method)).not.toContain("wallet_addEthereumChain");
  });

  it("does not ask to switch when already on the right chain", async () => {
    const w = fakeWallet({ chainId: 31337 });
    await connectMetaMask(w.eth, { chainId: 31337 });
    expect(w.calls.map((c) => c.method)).not.toContain("wallet_switchEthereumChain");
  });

  it("adds the local network first when the wallet has never heard of it", async () => {
    const w = fakeWallet({ chainId: 1, unknownChain: true });
    await connectMetaMask(w.eth, { chainId: 31337, rpcUrl: "http://127.0.0.1:8545" });
    const methods = w.calls.map((c) => c.method);
    expect(methods.indexOf("wallet_addEthereumChain")).toBeGreaterThan(methods.indexOf("wallet_switchEthereumChain"));
    const add = w.calls.find((c) => c.method === "wallet_addEthereumChain")!.params as [any];
    expect(add[0]).toMatchObject({ chainId: "0x7a69", rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { symbol: "ETH", decimals: 18 } });
    expect(w.chain()).toBe(31337);
  });

  it("explains a missing wallet", async () => {
    const err = await connectMetaMask(undefined, { chainId: 31337 }).catch((e) => e);
    expect(err).toMatchObject({ code: "no_wallet" });
    expect(err.message).toContain("Demo mode");
  });

  it("distinguishes the user declining from a failure", async () => {
    const declined = await connectMetaMask(fakeWallet({ failOn: { eth_requestAccounts: { code: 4001 } } }).eth, { chainId: 31337 }).catch((e) => e);
    expect(declined).toMatchObject({ code: "rejected" });
    const declinedSwitch = await connectMetaMask(fakeWallet({ chainId: 1, failOn: { wallet_switchEthereumChain: { code: 4001 } } }).eth, { chainId: 31337 }).catch((e) => e);
    expect(declinedSwitch).toMatchObject({ code: "rejected" });
    const broken = await connectMetaMask(fakeWallet({ failOn: { eth_requestAccounts: { code: -32603 } } }).eth, { chainId: 31337 }).catch((e) => e);
    expect(broken).toMatchObject({ code: "failed" });
  });

  it("reports a network it cannot switch to", async () => {
    const err = await ensureChain(fakeWallet({ chainId: 1, failOn: { wallet_switchEthereumChain: { code: -32000 } } }).eth, { chainId: 31337 }).catch((e) => e);
    expect(err).toMatchObject({ code: "wrong_network" });
    expect(err.message).toContain("chain 1");
  });

  it("reports the user declining to add the network", async () => {
    const err = await ensureChain(fakeWallet({ chainId: 1, unknownChain: true, failOn: { wallet_addEthereumChain: { code: 4001 } } }).eth, { chainId: 31337 }).catch((e) => e);
    expect(err).toMatchObject({ code: "rejected" });
  });

  it("tells the app when the user changes account or network, and stops when asked", () => {
    const w = fakeWallet();
    const events = { onAccountsChanged: vi.fn(), onChainChanged: vi.fn() };
    const stop = watchWallet(w.eth, events);
    w.emit("accountsChanged", ["0xabc"]);
    w.emit("chainChanged", "0x1");
    expect(events.onAccountsChanged).toHaveBeenCalledWith(["0xabc"]);
    expect(events.onChainChanged).toHaveBeenCalledWith(1);

    stop();
    w.emit("accountsChanged", ["0xdef"]);
    expect(events.onAccountsChanged).toHaveBeenCalledTimes(1);
    expect([...w.listeners.values()].every((s) => s.size === 0)).toBe(true);
  });

  it("finds an injected wallet only when there is one", () => {
    expect(injectedWallet()).toBeUndefined();
    (window as any).ethereum = { request: vi.fn() };
    expect(injectedWallet()).toBeDefined();
    delete (window as any).ethereum;
  });
});
