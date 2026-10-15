import { create } from "zustand";
import { explainError } from "@dpp/shared";
import {
  connectDemo, connectMetaMask, defaultRpcUrl, ensureChain, injectedWallet, watchWallet, WalletError, type Eip1193, type Wallet,
} from "@/web3/wallet";

export type WalletMode = "none" | "demo" | "metamask";

export interface WalletState {
  mode: WalletMode;
  wallet: Wallet | null;
  /** Index of the built-in account in demo mode. */
  demoIndex: number | null;
  busy: boolean;
  error: string | null;
  /** The chain id the wallet reports, which can change under us in MetaMask. */
  chainId: number | null;
  useDemo(index: number): Promise<void>;
  useMetaMask(expectedChainId: number): Promise<void>;
  switchNetwork(expectedChainId: number): Promise<void>;
  disconnect(): void;
  clearError(): void;
}

interface Config {
  rpcUrl: () => string;
  ethereum: () => Eip1193 | undefined;
}
let config: Config = { rpcUrl: () => defaultRpcUrl(), ethereum: () => injectedWallet() };

/** Replaces how the store finds the node and the injected wallet (tests). */
export function configureWallet(c: Partial<Config>): void {
  config = { ...config, ...c };
}

let unwatch: (() => void) | null = null;

const message = (e: unknown) => (e instanceof WalletError ? e.message : explainError(e).explanation);

export const useWallet = create<WalletState>((set, get) => ({
  mode: "none",
  wallet: null,
  demoIndex: null,
  busy: false,
  error: null,
  chainId: null,

  async useDemo(index) {
    unwatch?.();
    unwatch = null;
    set({ busy: true, error: null });
    try {
      const wallet = await connectDemo(config.rpcUrl(), index);
      set({ mode: "demo", wallet, demoIndex: index, chainId: wallet.chainId, busy: false });
    } catch (e) {
      set({ busy: false, error: message(e) });
    }
  },

  async useMetaMask(expectedChainId) {
    set({ busy: true, error: null });
    try {
      const ethereum = config.ethereum();
      const wallet = await connectMetaMask(ethereum, { chainId: expectedChainId });
      unwatch?.();
      unwatch = ethereum
        ? watchWallet(ethereum, {
            // The simplest correct reaction to a change in the wallet is to reconnect with its new state.
            onAccountsChanged: (accounts) => (accounts.length ? void get().useMetaMask(expectedChainId) : get().disconnect()),
            onChainChanged: (chainId) => set({ chainId }),
          })
        : null;
      set({ mode: "metamask", wallet, demoIndex: null, chainId: wallet.chainId, busy: false });
    } catch (e) {
      set({ busy: false, error: message(e) });
    }
  },

  async switchNetwork(expectedChainId) {
    const ethereum = config.ethereum();
    if (!ethereum) return;
    set({ busy: true, error: null });
    try {
      await ensureChain(ethereum, { chainId: expectedChainId });
      set({ busy: false, chainId: expectedChainId });
    } catch (e) {
      set({ busy: false, error: message(e) });
    }
  },

  disconnect() {
    unwatch?.();
    unwatch = null;
    set({ mode: "none", wallet: null, demoIndex: null, chainId: null, error: null, busy: false });
  },

  clearError: () => set({ error: null }),
}));
