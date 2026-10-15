import type { Deployment } from "@dpp/shared";
import type { Bus } from "../bus";
import type { Rpc } from "../chain/rpc";
import type { RecordRow, Repo, StorageWriteRow, TxRow } from "../db/repo";
import type { Logger } from "../logger";
import { type RawBlock, type RawReceipt, toBig, toHexQuantity, toNumber } from "./rawTypes";
import { explainRevert } from "@dpp/shared";
import { LedgerReader } from "./ledgerReader";
import { TraceReader } from "./traceReader";
import { decodeCall, decodeLog, makeDecoder, sameAddress, type Decoder } from "./txDecoder";
import type { VerificationService } from "../verification";

export type IndexerState = "waiting-for-node" | "waiting-for-deploy" | "syncing" | "live" | "stopped";

export interface IndexerDeps {
  rpc: Rpc;
  repo: Repo;
  bus: Bus;
  log: Logger;
  /** Returns the current deployment file, or null when none exists yet. Called on every pass. */
  getDeployment: () => Deployment | null;
  pollMs?: number;
  /** Re-verifies the ledger after each pass; optional so the indexer can be used on its own. */
  verification?: VerificationService;
  /** Trace successful market transactions for the storage-write view (6.5). */
  traceStorage?: boolean;
}

export interface SyncReport {
  state: IndexerState;
  fromBlock: number | null;
  toBlock: number | null;
  blocks: number;
  txs: number;
  events: number;
  /** The index was wiped because the node or the contract changed. */
  reset: boolean;
}

export interface IndexerStatus {
  state: IndexerState;
  sessionId: string | null;
  headBlock: number | null;
  indexedBlock: number | null;
  message: string | null;
}

const LEDGER_PAGE = 50;

const NO_REPORT: Omit<SyncReport, "state"> = { fromBlock: null, toBlock: null, blocks: 0, txs: 0, events: 0, reset: false };

/**
 * Keeps the SQLite index in step with the chain. One `syncOnce()` pass detects a restarted node or a
 * new deployment, then ingests every block it has not seen yet. Call it in a loop (`start()`).
 */
export class Indexer {
  private state: IndexerState = "waiting-for-node";
  private stopped = false;
  private message: string | null = null;
  private deployment: Deployment | null = null;
  private decoder: Decoder | null = null;
  private running: Promise<SyncReport> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private blockReceiptsSupported = true;
  private lastHead: number | null = null;
  private reader: LedgerReader | null = null;
  private readonly traces: TraceReader;
  /** Product ids whose on-chain state must be re-read. */
  private dirtyProducts = new Set<number>();
  private allProductsDirty = true;
  /** Number of records in the index before the latest sync (for incremental verification). */
  private recordsBefore = 0;
  private recordsTrimmed = false;

  constructor(private readonly d: IndexerDeps) {
    this.traces = new TraceReader(d.rpc);
  }

  // ───────────────────────── public API ─────────────────────────

  status(): IndexerStatus {
    return {
      state: this.state,
      sessionId: this.d.repo.getMeta("session_id"),
      headBlock: this.lastHead,
      indexedBlock: this.d.repo.latestBlock()?.number ?? null,
      message: this.message,
    };
  }

  getDeployment(): Deployment | null {
    return this.deployment;
  }

  /** What the contract itself says about the ledger's integrity (`verifyLedger` and `auditRange`). */
  async onChainVerdict(): Promise<Awaited<ReturnType<LedgerReader["onChainVerdict"]>> | null> {
    return this.reader ? this.reader.onChainVerdict() : null;
  }

  getDecoder(): Decoder | null {
    return this.decoder;
  }

  /** Runs one pass. Concurrent calls share the pass that is already running. */
  syncOnce(): Promise<SyncReport> {
    if (!this.running) {
      this.running = this.pass().finally(() => { this.running = null; });
    }
    return this.running;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.state = "syncing";
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (e) {
        this.setState("waiting-for-node", e instanceof Error ? e.message : String(e));
        this.d.log.warn(`indexer pass failed: ${this.message}`);
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.d.pollMs ?? 400);
    };
    this.timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.state = "stopped";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  // ───────────────────────── one pass ─────────────────────────

  private setState(state: IndexerState, message: string | null = null): void {
    if (this.stopped) return;
    const changed = this.state !== state || this.message !== message;
    this.state = state;
    this.message = message;
    if (changed) this.d.bus.publish("indexer.status", this.status());
  }

  private async pass(): Promise<SyncReport> {
    const { rpc, repo, bus, log } = this.d;
    let reset = false;

    if (!(await rpc.ping())) {
      this.setState("waiting-for-node", "Cannot reach the node. Start it with `npm run dev:node`.");
      return { ...NO_REPORT, state: this.state };
    }

    // 1. Same node as last time? Block 0's hash identifies a node session.
    const genesis = await rpc.send<RawBlock>("eth_getBlockByNumber", ["0x0", false]);
    const known = repo.getMeta("session_id");
    if (known && known !== genesis.hash) {
      log.info("node restarted: discarding the old index");
      repo.wipe();
      bus.publish("chain.reset", { reason: "node-restarted", sessionId: genesis.hash });
      reset = true;
    }
    repo.setMeta("session_id", genesis.hash);

    // 2. Which contract? The deployment must belong to this node and the code must be there.
    const deployment = this.d.getDeployment();
    if (!deployment || deployment.sessionId !== genesis.hash) {
      this.deployment = null;
      this.decoder = null;
      this.setState("waiting-for-deploy", "No deployment for this node. Run `npm run dev:deploy`.");
      return { ...NO_REPORT, state: this.state, reset };
    }
    const code = await rpc.send<string>("eth_getCode", [deployment.contracts.market.address, "latest"]);
    if (!code || code === "0x") {
      this.deployment = null;
      this.decoder = null;
      this.setState("waiting-for-deploy", "The contract is not on this chain. Run `npm run dev:deploy`.");
      return { ...NO_REPORT, state: this.state, reset };
    }

    const key = `${deployment.contracts.market.address.toLowerCase()}@${deployment.deployBlock}`;
    if (repo.getMeta("deployment_key") && repo.getMeta("deployment_key") !== key) {
      log.info("contract redeployed: discarding the old index");
      repo.wipe();
      repo.setMeta("session_id", genesis.hash);
      bus.publish("chain.reset", { reason: "redeployed", sessionId: genesis.hash });
      reset = true;
    }
    repo.setMeta("deployment_key", key);
    if (this.deployment?.contracts.market.address !== deployment.contracts.market.address || !this.decoder) {
      this.decoder = makeDecoder(deployment);
      this.reader = new LedgerReader(rpc.provider, deployment);
      this.allProductsDirty = true;
    }
    if (reset) this.allProductsDirty = true;
    this.deployment = deployment;

    // 3. Did the chain move backwards (evm_revert) or branch? Forget what no longer exists.
    this.setState("syncing");
    const head = toNumber(await rpc.send<string>("eth_blockNumber"));
    this.lastHead = head;
    const rewound = await this.detectRewind(head, deployment.deployBlock);
    if (rewound) reset = true;

    // 4. New blocks.
    const latest = repo.latestBlock();
    const first = latest ? latest.number + 1 : deployment.deployBlock;

    let blocks = 0, txs = 0, events = 0;
    for (let n = first; n <= head; n++) {
      const r = await this.ingestBlock(n, head);
      if (!r) break; // chain moved under us; the next pass will sort it out
      blocks++; txs += r.txs; events += r.events;
    }

    const appended = await this.syncLedger();
    if (appended > 0 || reset || this.recordsTrimmed) this.d.verification?.refresh(reset || this.recordsTrimmed ? null : this.recordsBefore);
    this.recordsTrimmed = false;

    this.setState("live");
    return { state: this.state, fromBlock: blocks ? first : null, toBlock: blocks ? first + blocks - 1 : null, blocks, txs, events, reset };
  }

  // ───────────────────────── blocks ─────────────────────────

  private async fetchReceipts(block: RawBlock): Promise<Map<string, RawReceipt>> {
    const { rpc } = this.d;
    const out = new Map<string, RawReceipt>();
    if (block.transactions.length === 0) return out;

    if (this.blockReceiptsSupported) {
      try {
        const list = await rpc.send<RawReceipt[] | null>("eth_getBlockReceipts", [block.number]);
        if (list) {
          for (const r of list) out.set(r.transactionHash.toLowerCase(), r);
          return out;
        }
      } catch {
        this.blockReceiptsSupported = false; // older node: fall back to one call per transaction
      }
    }
    const receipts = await Promise.all(
      block.transactions.map((t) => rpc.send<RawReceipt | null>("eth_getTransactionReceipt", [t.hash])),
    );
    receipts.forEach((r) => r && out.set(r.transactionHash.toLowerCase(), r));
    return out;
  }

  /** Reads one block and everything in it, then writes it atomically. Returns null if it vanished. */
  private async ingestBlock(n: number, head: number): Promise<{ txs: number; events: number } | null> {
    const { rpc, repo, bus } = this.d;
    const dec = this.decoder!;

    const block = await rpc.send<RawBlock | null>("eth_getBlockByNumber", [toHexQuantity(n), true]);
    if (!block) return null;
    const receipts = await this.fetchReceipts(block);

    const timestamp = toNumber(block.timestamp);
    // Blocks mined just now are stamped with the wall clock; older ones (backfill) with the block time.
    const live = head - n <= 1;
    const minedAt = live ? Date.now() : timestamp * 1000;

    const txRows: TxRow[] = [];
    const storageRows = new Map<string, Omit<StorageWriteRow, "txHash">[]>();
    /** Storage values left by earlier transactions of this block, so "before" is exact in shared blocks. */
    const blockState = new Map<string, string>();
    const eventRows: Parameters<Repo["insertEvent"]>[0][] = [];

    for (const t of block.transactions) {
      const receipt = receipts.get(t.hash.toLowerCase());
      if (!receipt) continue;
      const value = toBig(t.value);
      const call = decodeCall(dec, t.to, t.input, value);
      const status = toNumber(receipt.status) === 1 ? 1 : 0;

      txRows.push({
        hash: t.hash,
        blockNumber: n,
        txIndex: toNumber(t.transactionIndex),
        from: t.from,
        to: t.to,
        nonce: toNumber(t.nonce),
        value: value.toString(),
        gasLimit: toBig(t.gas).toString(),
        maxFee: t.maxFeePerGas ? toBig(t.maxFeePerGas).toString() : t.gasPrice ? toBig(t.gasPrice).toString() : null,
        maxPriorityFee: t.maxPriorityFeePerGas ? toBig(t.maxPriorityFeePerGas).toString() : null,
        input: t.input,
        functionName: call?.functionName ?? null,
        args: call?.args ?? null,
        status,
        gasUsed: toBig(receipt.gasUsed).toString(),
        effectiveGasPrice: receipt.effectiveGasPrice ? toBig(receipt.effectiveGasPrice).toString() : null,
        revertData: null,
        revertName: null,
        revertArgs: null,
        revertApprox: false,
        lifecycleState: status === 1 ? "mined" : "failed",
        replacedBy: null,
        firstSeenAt: minedAt,
        minedAt,
      });

      const row = txRows[txRows.length - 1]!;
      if (call) {
        if (status === 0) {
          const revert = await this.traces.revertFor(t, n);
          if (revert.data) {
            const why = explainRevert(revert.data);
            row.revertData = revert.data;
            row.revertName = why.name;
            row.revertArgs = why.args;
          }
          row.revertApprox = revert.approx;
        } else if (this.d.traceStorage !== false && call.contract === "market") {
          const writes = await this.traces.storageWrites(t.hash);
          if (writes) storageRows.set(t.hash, await this.withBefore(writes, n, blockState));
        }
      }

      for (const log of receipt.logs) {
        const decoded = decodeLog(dec, log);
        if (!decoded) continue;
        eventRows.push({
          txHash: t.hash, logIndex: toNumber(log.logIndex), blockNumber: n, address: log.address,
          name: decoded.name, args: decoded.args,
        });
      }
    }

    repo.transaction(() => {
      repo.upsertBlock({ number: n, hash: block.hash, parentHash: block.parentHash, timestamp, txCount: block.transactions.length });
      for (const row of txRows) repo.upsertTx(row);
      for (const e of eventRows) repo.insertEvent(e);
      for (const [hash, rows] of storageRows) repo.replaceStorageWrites(hash, rows);
    });
    for (const e of eventRows) {
      const id = e.args.productId;
      if (id !== undefined) this.dirtyProducts.add(Number(id));
    }

    bus.publish("block.new", { number: n, hash: block.hash, txCount: block.transactions.length, timestamp });
    for (const row of txRows) {
      bus.publish(row.status === 1 ? "tx.mined" : "tx.failed", {
        hash: row.hash, blockNumber: n, functionName: row.functionName, from: row.from,
      });
    }
    return { txs: txRows.length, events: eventRows.length };
  }

  /**
   * Compares the newest indexed block with the node's block at the same height. If they differ, or
   * the chain is shorter, walks back to the last block both agree on and discards everything after it.
   * Returns true when something was discarded.
   */
  private async detectRewind(head: number, deployBlock: number): Promise<boolean> {
    const { rpc, repo, bus, log } = this.d;
    const latest = repo.latestBlock();
    if (!latest) return false;

    const onChain = (n: number) => rpc.send<{ hash: string } | null>("eth_getBlockByNumber", [toHexQuantity(n), false]);
    if (head >= latest.number && (await onChain(latest.number))?.hash === latest.hash) return false;

    let n = Math.min(latest.number, head);
    for (; n >= deployBlock; n--) {
      const stored = repo.getBlock(n);
      if (stored && (await onChain(n))?.hash === stored.hash) break;
    }
    const ancestor = Math.max(n, deployBlock - 1);

    log.info(`chain rewound: index was at block ${latest.number}, node agrees up to block ${ancestor}`);
    repo.rewindTo(ancestor);
    this.allProductsDirty = true;
    this.dirtyProducts.clear();
    bus.publish("chain.rewound", { fromBlock: latest.number, toBlock: ancestor, headBlock: head });
    return true;
  }

  /**
   * Re-reads every record from contract storage and updates the ones that differ. Storage can change
   * without a new block (the lab rewrites it directly), so this is called after each tamper.
   * Returns the indexes whose stored values changed.
   */
  async rescanStorage(): Promise<bigint[]> {
    const run = async () => {
      const { repo } = this.d;
      const reader = this.reader;
      if (!reader) return [];

      const length = await reader.ledgerLength();
      if (repo.recordCount() > length) {
        repo.deleteRecordsFrom(length);
        this.recordsTrimmed = true;
      }

      const changed: bigint[] = [];
      for (let offset = 0; offset < repo.recordCount(); offset += LEDGER_PAGE) {
        const page = await reader.records(offset, LEDGER_PAGE);
        repo.transaction(() => {
          for (const r of page) {
            const old = repo.getRecord(r.index);
            if (!old) continue;
            const same =
              old.productId === r.productId && old.action === r.action && old.actor.toLowerCase() === r.actor.toLowerCase() &&
              old.counterparty.toLowerCase() === r.counterparty.toLowerCase() && old.price === r.price &&
              old.timestamp === r.timestamp && old.prevHash === r.prevHash && old.hash === r.hash;
            if (same) continue;
            changed.push(r.index);
            repo.upsertRecord({
              ...old, productId: r.productId, action: r.action, actor: r.actor, counterparty: r.counterparty,
              price: r.price, timestamp: r.timestamp, prevHash: r.prevHash, hash: r.hash,
            });
          }
        });
      }
      this.recordsTrimmed = false;
      this.d.verification?.refresh(null);
      return changed;
    };
    // Wait for a running pass so the two never interleave their reads and writes.
    await this.running?.catch(() => undefined);
    return run();
  }

  /** Adds the value each slot held before the write, tracking earlier writes in the same block. */
  private async withBefore(
    writes: { slot: string; after: string; gasCost: number }[],
    blockNumber: number,
    blockState: Map<string, string>,
  ): Promise<Omit<StorageWriteRow, "txHash">[]> {
    const address = this.deployment!.contracts.market.address;
    const rows: Omit<StorageWriteRow, "txHash">[] = [];
    for (const [seq, w] of writes.entries()) {
      let before = blockState.get(w.slot);
      if (before === undefined) {
        const raw = await this.d.rpc.send<string>("eth_getStorageAt", [address, w.slot, toHexQuantity(Math.max(0, blockNumber - 1))]);
        before = "0x" + raw.replace(/^0x/, "").padStart(64, "0");
      }
      rows.push({ seq, slot: w.slot, before, after: w.after, gasCost: w.gasCost });
      blockState.set(w.slot, w.after);
    }
    return rows;
  }

  // ───────────────────────── ledger and products ─────────────────────────

  /**
   * Copies new ledger records from contract storage into the index, pairs each with the
   * `RecordAppended` event that created it, and refreshes the products that changed.
   * Returns how many records were added.
   */
  private async syncLedger(): Promise<number> {
    const { repo, bus } = this.d;
    const reader = this.reader;
    if (!reader) return 0;

    let have = repo.recordCount();
    const length = await reader.ledgerLength();
    if (have > length) {
      // The ledger is shorter than the index believes (chain rewound): drop the extra records.
      repo.deleteRecordsFrom(length);
      have = length;
      this.recordsTrimmed = true;
    }
    this.recordsBefore = have;

    let added = 0;
    for (let offset = have; offset < length; offset += LEDGER_PAGE) {
      const page = await reader.records(offset, Math.min(LEDGER_PAGE, length - offset));
      const events = repo.appendedEventsByIndex(offset, offset + page.length - 1);
      const batch: { row: RecordRow; txHash: string | null }[] = [];
      for (const r of page) {
        const ev = events.get(Number(r.index));
        batch.push({
          txHash: ev?.txHash ?? null,
          row: {
            index: r.index, productId: r.productId, action: r.action, actor: r.actor, counterparty: r.counterparty,
            price: r.price, timestamp: r.timestamp, prevHash: r.prevHash, hash: r.hash,
            txHash: ev?.txHash ?? null, blockNumber: ev?.blockNumber ?? null,
            eventProductId: ev ? BigInt(ev.args.productId!) : null,
            eventAction: ev ? Number(ev.args.action) : null,
            eventActor: ev?.args.actor ?? null,
            eventPrevHash: ev?.args.prevHash ?? null,
            eventHash: ev?.args.hash ?? null,
          },
        });
      }
      repo.transaction(() => batch.forEach((b) => repo.upsertRecord(b.row)));
      for (const { row } of batch) {
        this.dirtyProducts.add(Number(row.productId));
        bus.publish("record.appended", {
          index: row.index.toString(), productId: row.productId.toString(), action: row.action, actor: row.actor,
          hash: row.hash, txHash: row.txHash, blockNumber: row.blockNumber,
        });
      }
      added += page.length;
    }

    await this.syncProducts(reader);
    return added;
  }

  private async syncProducts(reader: LedgerReader): Promise<void> {
    const { repo } = this.d;
    const block = repo.latestBlock()?.number ?? null;

    let ids: number[];
    if (this.allProductsDirty) {
      const count = await reader.productCount();
      repo.deleteProductsAbove(count);
      ids = Array.from({ length: count }, (_, i) => i + 1);
    } else {
      ids = [...this.dirtyProducts].sort((a, b) => a - b);
    }
    this.dirtyProducts.clear();
    this.allProductsDirty = false;

    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const loaded = await Promise.all(chunk.map((id) => reader.product(id)));
      repo.transaction(() => {
        for (const { product, reservation } of loaded) {
          repo.upsertProduct({
            id: product.id, name: product.name, owner: product.owner, price: product.price,
            reservedBy: reservation?.buyer ?? null, reservedAmount: reservation?.amount ?? null,
            reservedExpires: reservation?.expiresAt ?? null, updatedBlock: block,
          });
        }
      });
    }
  }
}
