import type { ApiTx, WsMessage } from "@dpp/shared";
import { SNIPPETS, type Snippet } from "./snippets";

export type NarrationLevel = "info" | "good" | "bad";

export interface Narration {
  id: string;
  title: string;
  /** Plain English, with [[glossary]] markers. */
  body: string;
  /** Extra depth, shown in Detailed mode. */
  detail?: string;
  code?: Snippet;
  level: NarrationLevel;
  /** A lesson that goes deeper. */
  lesson?: string;
  at: number;
}

export interface NarrationContext {
  findTx(hash: string): ApiTx | undefined;
}

const n = (v: unknown) => String(v ?? "?");
const call = (fn?: unknown, args?: unknown) => {
  const a = args && typeof args === "object" ? Object.values(args as Record<string, unknown>).join(", ") : "";
  return fn ? `${fn}(${a})` : "a transaction";
};

/**
 * Turns one live message into a short explanation for the side panel. Returns null for traffic that
 * would only be noise (status chatter, scenario progress).
 */
export function narrate(m: WsMessage, ctx: NarrationContext): Narration | null {
  const d = (m.data ?? {}) as Record<string, unknown>;
  const base = { id: `${m.seq}-${m.type}`, at: m.at };

  switch (m.type) {
    case "block.new":
      return {
        ...base, level: "info", title: `Ethereum block ${n(d.number)} mined`,
        body: Number(d.txCount) === 0
          ? "The node mined an empty [[block]]. Blocks are how transactions get included; this one carried none."
          : `The node mined a [[block]] containing ${n(d.txCount)} transaction${Number(d.txCount) === 1 ? "" : "s"}. Ethereum's chain of blocks is separate from the ledger's chain of records.`,
        detail: "Each Ethereum block points at its parent's hash too, which is a second hash chain running underneath the ledger's one.",
        lesson: "making-a-chain",
      };

    case "tx.pending":
      return {
        ...base, level: "info", title: "Waiting in the mempool",
        body: `${call(d.functionName, d.args)} was sent and is waiting in the [[mempool]]. Until a block includes it, it is only a request: it can still be replaced by another with the same [[nonce]], or dropped.`,
        lesson: "a-sale-step-by-step",
      };

    case "tx.mined":
      return {
        ...base, level: "good", title: "Transaction mined",
        body: `${call(d.functionName)} was included in block ${n(d.blockNumber)} and the contract accepted it. If it changes a product, a new ledger [[record]] follows.`,
        lesson: "a-sale-step-by-step",
      };

    case "tx.failed": {
      const tx = typeof d.hash === "string" ? ctx.findTx(d.hash) : undefined;
      const why = tx?.revert;
      return {
        ...base, level: "bad", title: why ? `Refused: ${why.title}` : "Transaction reverted",
        body: why
          ? `${why.explanation} The transaction was mined, but the contract [[revert]]ed it: every change was undone, so nothing was recorded in the ledger. The [[gas]] was still spent.`
          : "The transaction was mined, but the contract [[revert]]ed it. Every change was undone, so nothing was recorded, but the [[gas]] was spent.",
        detail: why ? `How to fix it: ${why.fix}` : undefined,
        code: why?.name ? SNIPPETS[why.name] : undefined,
        lesson: "rules-and-reverts",
      };
    }

    case "tx.replaced":
      return {
        ...base, level: "info", title: "Replaced before it ran",
        body: "Another transaction with the same [[nonce]] and a higher fee took its place. The original was never mined, so it changed nothing and cost nothing.",
        detail: "This is how a pending transaction is cancelled: send a 0-ETH transfer to yourself with the same nonce and a higher fee.",
        lesson: "three-ways-to-take-something-back",
      };

    case "tx.dropped":
      return {
        ...base, level: "info", title: "Dropped from the mempool",
        body: "The node removed the transaction before any block included it. It never ran, so nothing was recorded.",
        lesson: "three-ways-to-take-something-back",
      };

    case "record.appended":
      return {
        ...base, level: "good", title: `Ledger record #${n(d.index)} added`,
        body: `The contract appended a new [[record]]. Its [[prevhash]] is the [[hash]] of record #${Math.max(0, Number(d.index) - 1)}, and its own hash covers all of its fields. That link is what makes the records a chain.`,
        detail: "The contract also emitted a RecordAppended [[eventlog]] entry with the same hashes. It cannot be edited later, which makes it an independent witness.",
        lesson: "making-a-chain",
      };

    case "verification.changed": {
      const ok = d.valid === true;
      return {
        ...base, level: ok ? "good" : "bad", title: ok ? "Every record verifies" : `Record #${n(d.firstBrokenAt)} no longer verifies`,
        body: ok
          ? "The [[hash]] of every record matches its data, every link matches, and the [[eventlog]] agrees."
          : `The first problem is at record #${n(d.firstBrokenAt)}. Something in the stored data no longer matches its [[hash]], or its link to the previous record, or the original [[eventlog]].`,
        lesson: ok ? undefined : "breaking-the-chain",
      };
    }

    case "chain.reset":
      return {
        ...base, level: "info", title: "The chain was reset",
        body: "The local node restarted, or the contract was redeployed, so the old chain is gone and this view started over.",
        detail: "If MetaMask shows stuck or rejected transactions afterwards: Settings → Advanced → Clear activity tab data. Its remembered [[nonce]]s belong to the old chain.",
      };

    case "chain.rewound":
      return {
        ...base, level: "info", title: "The chain was rewound",
        body: `It went back from block ${n(d.fromBlock)} to block ${n(d.toBlock)}, as when a [[snapshot]] is restored. Everything after that point no longer exists.`,
      };

    case "lab.tampered": {
      const mode = n(d.mode);
      const on = d.onChain as { valid?: boolean } | null;
      const off = d.offChain as { valid?: boolean } | undefined;
      const fooled = on?.valid === true && off?.valid === false;
      return {
        ...base, level: "bad", title: `Stored data edited (${mode})`,
        body: fooled
          ? "Stored records were rewritten so that every [[hash]] and link is consistent. The contract's own check says everything is fine, but the [[eventlog]], which cannot be rewritten, still holds the originals."
          : `Stored data was changed directly in the contract's [[slot]]s (${mode}). Watch which of the defences notice.`,
        detail: "Only possible because this is a local chain you control. On a real network nobody can rewrite stored data.",
        lesson: "breaking-the-chain",
      };
    }

    case "lab.restored":
      return { ...base, level: "good", title: "Restored", body: "The edits were undone and the stored data is back to what the contract wrote.", lesson: "breaking-the-chain" };

    case "mining.changed": {
      const mode = n(d.mode);
      return {
        ...base, level: "info", title: mode === "manual" ? "Step mode" : mode === "interval" ? "Slow motion" : "Automatic mining",
        body:
          mode === "manual"
            ? "Transactions now wait in the [[mempool]] until you press Mine block. This lets you watch each step."
            : mode === "interval"
              ? "A block is mined every few seconds, so you can watch transactions move through at a human pace."
              : "Every transaction is mined the moment it is sent.",
      };
    }

    default:
      return null;
  }
}
