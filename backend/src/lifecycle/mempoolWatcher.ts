import type { Bus } from "../bus";
import type { Rpc } from "../chain/rpc";
import type { Repo, TxRow } from "../db/repo";
import type { Indexer } from "../indexer/indexer";
import { type RawBlock, type RawTx, toBig, toNumber } from "../indexer/rawTypes";
import { decodeCall } from "../indexer/txDecoder";
import type { Logger } from "../logger";
import { canTransition } from "./txStateMachine";

export interface PollReport {
  seenPending: string[];
  replaced: string[];
  dropped: string[];
}

export interface MempoolDeps {
  rpc: Rpc;
  repo: Repo;
  bus: Bus;
  log: Logger;
  /** Needed to decode the calldata of pending transactions. */
  indexer: Pick<Indexer, "getDecoder">;
}

/**
 * Watches the node's pending block. Transactions that appear are recorded as `pending`; ones that
 * disappear without being mined are marked `replaced` (another transaction took their nonce) or
 * `dropped` (they were removed). Run it after an indexer pass, so anything that was mined is already
 * known and is not mistaken for a drop.
 */
export class MempoolWatcher {
  constructor(private readonly d: MempoolDeps) {}

  async poll(): Promise<PollReport> {
    const { rpc, repo, bus } = this.d;
    const report: PollReport = { seenPending: [], replaced: [], dropped: [] };

    let pendingBlock: RawBlock | null = null;
    try {
      pendingBlock = await rpc.send<RawBlock | null>("eth_getBlockByNumber", ["pending", true]);
    } catch {
      return report; // node without a pending block: nothing to watch
    }
    const inPool = new Map<string, RawTx>();
    for (const t of pendingBlock?.transactions ?? []) inPool.set(t.hash.toLowerCase(), t);

    // 1. New pending transactions.
    for (const t of inPool.values()) {
      if (repo.getTx(t.hash)) continue;
      const row = this.pendingRow(t);
      repo.upsertTx(row);
      report.seenPending.push(t.hash);
      bus.publish("tx.pending", { hash: t.hash, from: t.from, nonce: row.nonce, functionName: row.functionName, args: row.args });

      // Same sender and nonce as another pending transaction: this one replaces it.
      for (const old of repo.findPendingBySenderNonce(t.from, row.nonce, t.hash)) {
        this.markReplaced(old, t.hash, report);
      }
    }

    // 2. Pending transactions that left the pool without being mined.
    for (const row of repo.listTxs({ state: "pending", limit: 1000 })) {
      if (inPool.has(row.hash.toLowerCase())) continue;
      const onChain = await rpc.send<RawTx | null>("eth_getTransactionByHash", [row.hash]).catch(() => null);
      if (onChain?.blockNumber) continue; // mined: the indexer will record it on its next pass

      const successor = this.minedWithSameNonce(row);
      if (successor) {
        this.markReplaced(row, successor.hash, report);
        continue;
      }

      // The sender's nonce already moved past this one, so *some* transaction used it and it was not this
      // one. That transaction is not indexed yet; leave this as pending and let the indexer mark it
      // replaced once it ingests the block. Calling it "dropped" now would be wrong.
      const confirmed = toNumber(await rpc.send<string>("eth_getTransactionCount", [row.from, "latest"]));
      if (confirmed > row.nonce) continue;

      this.markDropped(row.hash, report);
    }
    return report;
  }

  /** Marks a pending transaction dropped now (the lab calls this right after dropping it). */
  markDropped(hash: string, report?: PollReport): void {
    const { repo, bus } = this.d;
    const row = repo.getTx(hash);
    if (!row || !canTransition(row.lifecycleState, "dropped") || row.lifecycleState === "dropped") return;
    repo.upsertTx({ ...row, lifecycleState: "dropped" });
    report?.dropped.push(hash);
    bus.publish("tx.dropped", { hash, from: row.from, nonce: row.nonce });
  }

  private markReplaced(old: TxRow, replacedBy: string, report: PollReport): void {
    const { repo, bus } = this.d;
    if (!canTransition(old.lifecycleState, "replaced") || old.lifecycleState === "replaced") return;
    repo.upsertTx({ ...old, lifecycleState: "replaced", replacedBy });
    report.replaced.push(old.hash);
    bus.publish("tx.replaced", { hash: old.hash, replacedBy, from: old.from, nonce: old.nonce });
  }

  private minedWithSameNonce(row: TxRow): TxRow | null {
    const rows = this.d.repo.listTxs({ from: row.from, limit: 200 });
    return rows.find((r) => r.nonce === row.nonce && r.hash !== row.hash && r.blockNumber !== null) ?? null;
  }

  private pendingRow(t: RawTx): TxRow {
    const dec = this.d.indexer.getDecoder();
    const value = toBig(t.value);
    const call = dec ? decodeCall(dec, t.to, t.input, value) : null;
    return {
      hash: t.hash, blockNumber: null, txIndex: null, from: t.from, to: t.to, nonce: toNumber(t.nonce),
      value: value.toString(), gasLimit: toBig(t.gas).toString(),
      maxFee: t.maxFeePerGas ? toBig(t.maxFeePerGas).toString() : t.gasPrice ? toBig(t.gasPrice).toString() : null,
      maxPriorityFee: t.maxPriorityFeePerGas ? toBig(t.maxPriorityFeePerGas).toString() : null,
      input: t.input, functionName: call?.functionName ?? (t.to === null ? "deploy" : null), args: call?.args ?? null,
      status: null, gasUsed: null, effectiveGasPrice: null, revertData: null, revertName: null, revertArgs: null,
      revertApprox: false, lifecycleState: "pending", replacedBy: null, firstSeenAt: Date.now(), minedAt: null,
    };
  }
}
