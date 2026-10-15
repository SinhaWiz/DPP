import { useEffect, useState, type ReactNode } from "react";
import { createApi } from "@/api/client";
import { fetchDeployment, loadDirect } from "@/lib/direct";
import { defaultRpcUrl } from "@/web3/wallet";
import { RolesProvider } from "@/lib/roles";
import { ensureTxFlow, setTxFlow } from "@/store/flowInstance";
import { narrate } from "@/lib/narration";
import { useNarration } from "@/store/narration";
import { useTally } from "@/store/eventTally";
import { LiveController, ensureLiveController, getLiveController, setLiveController, useLive } from "@/store/live";
import { TxFlow } from "@/store/txFlow";
import { useWallet } from "@/store/wallet";
import { MarketClient } from "@/web3/market";

function Roles({ children }: { children: ReactNode }) {
  const roles = useLive((s) => s.session?.roles ?? []);
  return <RolesProvider roles={roles}>{children}</RolesProvider>;
}

/** Builds the transaction flow for whoever is acting right now. */
function createFlow(live: LiveController): TxFlow {
  let cached: { signer: unknown; address: string; client: MarketClient } | null = null;
  const flow = new TxFlow({
    api: live.api,
    pollMs: 2000,
    market: () => {
      const wallet = useWallet.getState().wallet;
      const address = live.state.session?.contracts?.market;
      if (!wallet || !address) return null;
      if (!cached || cached.signer !== wallet.signer || cached.address !== address) {
        cached = { signer: wallet.signer, address, client: new MarketClient(address, wallet.signer) };
      }
      return cached.client;
    },
    who: () => {
      const wallet = useWallet.getState().wallet;
      if (!wallet) return null;
      const role = live.state.session?.roles.find((r) => r.address.toLowerCase() === wallet.address.toLowerCase());
      return { address: wallet.address, role: role?.name ?? null };
    },
  });
  // The flow learns about the chain the same way the rest of the UI does: from the live message stream.
  live.store.subscribe((state, prev) => {
    if (state.lastMessage && state.lastMessage !== prev.lastMessage) flow.onMessage(state.lastMessage);
  });
  return flow;
}

const narrating = new WeakSet<LiveController>();

/** Turns the live message stream into explanations for the side panel. Once per controller. */
function startNarration(live: LiveController): void {
  if (narrating.has(live)) return;
  narrating.add(live);
  live.store.subscribe((state, prev) => {
    if (!state.lastMessage || state.lastMessage === prev.lastMessage) return;
    useTally.getState().record(state.lastMessage);
    const note = narrate(state.lastMessage, { findTx: (hash) => live.state.txs.find((t) => t.hash.toLowerCase() === hash.toLowerCase()) });
    if (note) useNarration.getState().push(note);
  });
}

/**
 * Starts the live data layer and the transaction flow for the whole app, and makes role names
 * available everywhere. Pass `controller` / `flow` to run against fakes (tests).
 */
export function AppProviders({ children, controller, flow }: { children: ReactNode; controller?: LiveController; flow?: TxFlow }) {
  // Both initialisers below can run twice (React StrictMode), so they must create things at most once.
  const [live] = useState(() => {
    if (controller) {
      setLiveController(controller);
      return controller;
    }
    return ensureLiveController(() => new LiveController({
      api: createApi(),
      directPollMs: 2500,
      direct: async () => {
        const deployment = await fetchDeployment();
        return deployment ? loadDirect(defaultRpcUrl(), deployment) : null;
      },
    }));
  });
  useState(() => {
    if (flow) setTxFlow(flow);
    else ensureTxFlow(() => createFlow(getLiveController()));
    startNarration(getLiveController());
    return null;
  });
  useEffect(() => {
    live.start();
    // Development aid: inspect the live state from the browser console (and from the end-to-end tests).
    if (import.meta.env.DEV) (window as unknown as { __ledgerLab?: unknown }).__ledgerLab = { live };
    return () => live.stop();
  }, [live]);
  return <Roles>{children}</Roles>;
}
