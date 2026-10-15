import type { ApiSession, WsMessage } from "@dpp/shared";
import type { Comparison } from "./verifyInBrowser";

export type NoticeLevel = "error" | "warning" | "info";

export interface Notice {
  /** Stable key; dismissing a notice remembers this plus `version`. */
  id: string;
  level: NoticeLevel;
  title: string;
  body: string;
  /** Changes when the same kind of event happens again, so a dismissed notice can return. */
  version?: number;
  dismissible: boolean;
  action?: { label: string; kind: "switch-network" | "retry" };
}

export interface NoticeInput {
  link: "connecting" | "live" | "offline";
  /** The UI has talked to the backend at least once. */
  loaded: boolean;
  session: ApiSession | null;
  /** Chain id the connected wallet is on, or null when no wallet is connected. */
  walletChainId: number | null;
  lastReset: WsMessage | null;
  lastRewind: WsMessage | null;
  comparison: Comparison | null;
  /** The backend is down but the browser is reading the node directly. */
  direct?: boolean;
}

/** Turns the app's state into the problems and events a learner needs to hear about, most urgent first. */
export function computeNotices(i: NoticeInput): Notice[] {
  const out: Notice[] = [];

  if (i.link === "offline" && i.direct) {
    out.push({
      id: "direct-mode", level: "warning", dismissible: false, title: "Backend offline: read-only view",
      body: "The page is reading the chain straight from the node and checking it in your browser. Transaction history, the mempool and the lab need the backend: start it with `npm run dev:backend` and it reconnects on its own.",
      action: { label: "Try again", kind: "retry" },
    });
  } else if (i.link === "offline") {
    out.push({
      id: "backend-offline", level: "error", dismissible: false,
      title: i.loaded ? "Lost the connection to the backend" : "Can't reach the backend",
      body: "The page is showing what it last knew. Start the backend with `npm run dev:backend` (or `npm run dev` for everything); it reconnects on its own.",
      action: { label: "Try again", kind: "retry" },
    });
  }

  const state = i.session?.indexer.state;
  if (i.link !== "offline" && i.session) {
    if (state === "waiting-for-node") {
      out.push({
        id: "node-down", level: "error", dismissible: false, title: "The local node isn't running",
        body: i.session.indexer.message ?? "Start it with `npm run dev:node`.",
      });
    } else if (state === "waiting-for-deploy") {
      out.push({
        id: "no-deployment", level: "warning", dismissible: false, title: "No contract is deployed on this node",
        body: i.session.indexer.message ?? "Run `npm run dev:deploy`, or use Reset in the lab.",
      });
    }
  }

  if (i.walletChainId !== null && i.session?.chainId != null && i.walletChainId !== i.session.chainId) {
    out.push({
      id: "wrong-network", level: "error", dismissible: false, title: "Your wallet is on the wrong network",
      body: `It is on chain ${i.walletChainId}, but this app uses chain ${i.session.chainId}. Transactions would go to the wrong place.`,
      action: { label: "Switch network", kind: "switch-network" },
    });
  }

  if (i.comparison && !i.comparison.agree) {
    const first = i.comparison.diffs[0]!;
    out.push({
      id: "verify-disagree", level: "error", dismissible: false, title: "Your browser disagrees with the server",
      body: `For record #${first.index} the server says “${first.server}” but your browser's own check says “${first.browser}”` +
        `${i.comparison.diffs.length > 1 ? ` (and ${i.comparison.diffs.length - 1} more)` : ""}. Trust your browser's check: it recomputed the hashes itself.`,
    });
  }

  if (i.lastReset) {
    const reason = (i.lastReset.data as { reason?: string })?.reason;
    out.push({
      id: "chain-reset", version: i.lastReset.seq, level: "info", dismissible: true,
      title: reason === "redeployed" ? "The contract was redeployed" : "The local node restarted",
      body: "The old chain is gone and the view started over. If MetaMask now shows stuck or rejected transactions: Settings → Advanced → Clear activity tab data.",
    });
  }
  if (i.lastRewind) {
    const d = i.lastRewind.data as { fromBlock?: number; toBlock?: number };
    out.push({
      id: "chain-rewound", version: i.lastRewind.seq, level: "info", dismissible: true, title: "The chain was rewound",
      body: `It went back from block ${d.fromBlock ?? "?"} to block ${d.toBlock ?? "?"} (a snapshot was restored). Blocks and transactions after that point no longer exist.`,
    });
  }
  return out;
}
