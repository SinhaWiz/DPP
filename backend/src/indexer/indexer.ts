import type { Deployment } from "@dpp/shared";
import type { Bus } from "../bus";
import type { Rpc } from "../chain/rpc";
import type { Repo, TxRow } from "../db/repo";
import type { Logger } from "../logger";
import { type RawBlock, type RawReceipt, toBig, toHexQuantity, toNumber } from "./rawTypes";
import { decodeCall, decodeLog, makeDecoder, sameAddress, type Decoder } from "./txDecoder";

export type IndexerState = "waiting-for-node" | "waiting-for-deploy" | "syncing" | "live" | "stopped";

export interface IndexerDeps {
  rpc: Rpc;
  repo: Repo;
  bus: Bus;
  log: Logger;
  /** Returns the current deployment file, or null when none exists yet. Called on every pass. */
  getDeployment: () => Deployment | null;
  pollMs?: number;
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

  constructor(private readonly d: IndexerDeps) {}

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
    }
    this.deployment = deployment;

    // 3. New blocks.
    this.setState("syncing");
    const head = toNumber(await rpc.send<string>("eth_blockNumber"));
    this.lastHead = head;
    const latest = repo.latestBlock();
    const first = latest ? latest.number + 1 : deployment.deployBlock;

    let blocks = 0, txs = 0, events = 0;
    for (let n = first; n <= head; n++) {
      const r = await this.ingestBlock(n, head);
      if (!r) break; // chain moved under us; the next pass will sort it out
      blocks++; txs += r.txs; events += r.events;
    }

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
    });

    bus.publish("block.new", { number: n, hash: block.hash, txCount: block.transactions.length, timestamp });
    for (const row of txRows) {
      bus.publish(row.status === 1 ? "tx.mined" : "tx.failed", {
        hash: row.hash, blockNumber: n, functionName: row.functionName, from: row.from,
      });
    }
    return { txs: txRows.length, events: eventRows.length };
  }
}

export { sameAddress };
