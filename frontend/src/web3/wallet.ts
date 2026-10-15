import { BrowserProvider, JsonRpcProvider, type Signer } from "ethers";

/** The EIP-1193 provider a browser wallet injects as `window.ethereum`. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

export type WalletKind = "demo" | "metamask";

export interface Wallet {
  kind: WalletKind;
  address: string;
  signer: Signer;
  /** Chain the wallet is connected to. */
  chainId: number;
}

export class WalletError extends Error {
  constructor(readonly code: "no_wallet" | "rejected" | "wrong_network" | "unreachable" | "failed", message: string) {
    super(message);
    this.name = "WalletError";
  }
}

const hex = (n: number) => "0x" + n.toString(16);
const codeOf = (e: unknown): number | string | undefined => (e as { code?: number | string } | null)?.code;

/** Same-origin URL of the node's JSON-RPC (the dev server proxies /rpc to it). */
export function defaultRpcUrl(loc: Pick<Location, "origin"> = window.location): string {
  return `${loc.origin}/rpc`;
}

/**
 * Demo mode: act as one of the node's built-in accounts. The node holds those accounts unlocked, so
 * there is nothing to sign in a wallet and no private key ever reaches the browser.
 */
export async function connectDemo(rpcUrl: string, accountIndex: number): Promise<Wallet> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const signer = await provider.getSigner(accountIndex);
    const [address, network] = await Promise.all([signer.getAddress(), provider.getNetwork()]);
    return { kind: "demo", address, signer, chainId: Number(network.chainId) };
  } catch (e) {
    provider.destroy();
    throw new WalletError("unreachable", `Cannot reach the node at ${rpcUrl}. Start it with \`npm run dev:node\`. (${e instanceof Error ? e.message : e})`);
  }
}

export interface MetaMaskOptions {
  chainId: number;
  rpcUrl?: string;
  chainName?: string;
}

/**
 * Connects an injected wallet and makes sure it is on the local chain, asking it to switch (or to add
 * the chain first) when it is not.
 */
export async function connectMetaMask(ethereum: Eip1193 | undefined, o: MetaMaskOptions): Promise<Wallet> {
  if (!ethereum) throw new WalletError("no_wallet", "No wallet found. Install MetaMask, or use Demo mode.");

  try {
    await ethereum.request({ method: "eth_requestAccounts" });
  } catch (e) {
    if (codeOf(e) === 4001) throw new WalletError("rejected", "You declined the connection request in your wallet.");
    throw new WalletError("failed", `The wallet refused to connect: ${e instanceof Error ? e.message : e}`);
  }

  await ensureChain(ethereum, o);

  const provider = new BrowserProvider(ethereum, o.chainId);
  const signer = await provider.getSigner();
  return { kind: "metamask", address: await signer.getAddress(), signer, chainId: o.chainId };
}

/** Switches the wallet to `chainId`, adding the local network if the wallet has never heard of it. */
export async function ensureChain(ethereum: Eip1193, o: MetaMaskOptions): Promise<void> {
  const current = Number(BigInt((await ethereum.request({ method: "eth_chainId" })) as string));
  if (current === o.chainId) return;

  const switchTo = () => ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(o.chainId) }] });
  try {
    await switchTo();
  } catch (e) {
    if (codeOf(e) === 4902) {
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hex(o.chainId),
            chainName: o.chainName ?? "Ledger Lab (local)",
            rpcUrls: [o.rpcUrl ?? "http://127.0.0.1:8545"],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          }],
        });
        await switchTo();
        return;
      } catch (inner) {
        if (codeOf(inner) === 4001) throw new WalletError("rejected", "You declined adding the local network.");
        throw new WalletError("wrong_network", `Could not add the local network to your wallet: ${inner instanceof Error ? inner.message : inner}`);
      }
    }
    if (codeOf(e) === 4001) throw new WalletError("rejected", "You declined switching networks.");
    throw new WalletError("wrong_network", `Your wallet is on chain ${current}; switch it to ${o.chainId}.`);
  }
}

export interface WalletEvents {
  onAccountsChanged(accounts: string[]): void;
  onChainChanged(chainId: number): void;
}

/** Listens for the user switching account or network in the wallet. Returns an unsubscribe function. */
export function watchWallet(ethereum: Eip1193, events: WalletEvents): () => void {
  const accounts = (a: string[]) => events.onAccountsChanged(a);
  const chain = (id: string) => events.onChainChanged(Number(BigInt(id)));
  ethereum.on?.("accountsChanged", accounts);
  ethereum.on?.("chainChanged", chain);
  return () => {
    ethereum.removeListener?.("accountsChanged", accounts);
    ethereum.removeListener?.("chainChanged", chain);
  };
}

/** `window.ethereum` if a wallet injected one. */
export function injectedWallet(): Eip1193 | undefined {
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}
