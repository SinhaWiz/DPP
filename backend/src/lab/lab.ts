import type { Bus } from "../bus";
import type { Rpc } from "../chain/rpc";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Indexer } from "../indexer/indexer";
import type { MempoolWatcher } from "../lifecycle/mempoolWatcher";
import type { Logger } from "../logger";
import type { VerificationService } from "../verification";
import type { RawTx } from "../indexer/rawTypes";
import { toBig, toHexQuantity } from "../indexer/rawTypes";
import { labAvailability, type LabAvailability } from "./guard";

export class LabError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface LabDeps {
  config: Config;
  rpc: Rpc;
  repo: Repo;
  bus: Bus;
  log: Logger;
  indexer: Indexer;
  watcher: MempoolWatcher;
  verification: VerificationService;
}

export interface SnapshotRecord {
  name: string;
  /** The node's evm_snapshot id. Single-use. */
  id: string;
  block: number;
  createdAt: number;
}

export type MiningMode = "auto" | "manual" | "interval";

export interface MiningState {
  mode: MiningMode;
  automine: boolean;
  intervalMs: number | null;
}

/**
 * Controls the local dev chain for the visualizer: when blocks are mined, what time it is, which
 * pending transactions survive, snapshots, and direct edits of contract storage. Every method assumes
 * `assertAvailable()` passed; the HTTP layer enforces that for every /api/lab route.
 */
export class Lab {
  private intervalMs: number | null = null;
  private clients = 0;
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(readonly d: LabDeps) {}

  // ───────────────────────── availability ─────────────────────────

  async chainId(): Promise<number | null> {
    const fromDeployment = this.d.indexer.getDeployment()?.chainId;
    if (fromDeployment !== undefined) return fromDeployment;
    try {
      return Number(BigInt(await this.d.rpc.send<string>("eth_chainId")));
    } catch {
      return null;
    }
  }

  async availability(): Promise<LabAvailability> {
    return labAvailability(this.d.config, await this.chainId());
  }

  async assertAvailable(): Promise<void> {
    const a = await this.availability();
    if (!a.available) throw new LabError(403, "lab_unavailable", a.reason ?? "The lab is not available");
  }

  // ───────────────────────── mining ─────────────────────────

  async mining(): Promise<MiningState> {
    let automine = true;
    try {
      automine = await this.d.rpc.send<boolean>("hardhat_getAutomine");
    } catch {
      // older node: assume automine
    }
    const mode: MiningMode = automine ? "auto" : this.intervalMs ? "interval" : "manual";
    return { mode, automine, intervalMs: automine ? null : this.intervalMs };
  }

  /**
   * auto: every transaction is mined at once.
   * manual: transactions wait in the mempool until `mine()`.
   * interval: a block is mined every `intervalMs` (slow motion).
   */
  async setMining(mode: MiningMode, intervalMs?: number): Promise<MiningState> {
    const { rpc } = this.d;
    if (mode === "interval") {
      if (!intervalMs || intervalMs < 100 || intervalMs > 60_000) {
        throw new LabError(400, "bad_request", "intervalMs must be between 100 and 60000");
      }
      await rpc.send("evm_setAutomine", [false]);
      await rpc.send("evm_setIntervalMining", [intervalMs]);
      this.intervalMs = intervalMs;
    } else {
      await rpc.send("evm_setIntervalMining", [0]);
      this.intervalMs = null;
      await rpc.send("evm_setAutomine", [mode === "auto"]);
    }
    const state = await this.mining();
    this.d.bus.publish("mining.changed", state);
    return state;
  }

  /** Mines `blocks` blocks now, then lets the indexer catch up so the caller sees the result. */
  async mine(blocks = 1): Promise<{ mined: number; headBlock: number }> {
    if (!Number.isInteger(blocks) || blocks < 1 || blocks > 100) throw new LabError(400, "bad_request", "blocks must be between 1 and 100");
    for (let i = 0; i < blocks; i++) await this.d.rpc.send("evm_mine");
    await this.settle();
    return { mined: blocks, headBlock: Number(BigInt(await this.d.rpc.send<string>("eth_blockNumber"))) };
  }

  /** Moves the chain's clock forward (for reservation expiry) and mines a block so it takes effect. */
  async increaseTime(seconds: number): Promise<{ timestamp: number }> {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30 * 24 * 3600) {
      throw new LabError(400, "bad_request", "seconds must be between 1 and 2592000 (30 days)");
    }
    await this.d.rpc.send("evm_increaseTime", [seconds]);
    await this.d.rpc.send("evm_mine");
    await this.settle();
    const block = await this.d.rpc.send<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
    return { timestamp: Number(BigInt(block.timestamp)) };
  }

  /** Indexes whatever was just mined, then re-checks the mempool, so API responses are up to date. */
  async settle(): Promise<void> {
    await this.d.indexer.syncOnce();
    await this.d.watcher.poll();
  }

  // ───────────────────────── pending transactions ─────────────────────────

  private async pendingTx(hash: string): Promise<RawTx> {
    const tx = await this.d.rpc.send<RawTx | null>("eth_getTransactionByHash", [hash]).catch(() => null);
    if (!tx) throw new LabError(404, "not_found", "That transaction is not known to the node");
    if (tx.blockNumber) throw new LabError(409, "not_pending", "That transaction was already mined; it can no longer be dropped or replaced");
    return tx;
  }

  /** Removes a transaction from the mempool. It is never mined, and nothing about it reaches the ledger. */
  async dropTx(hash: string): Promise<{ hash: string; dropped: true }> {
    await this.pendingTx(hash);
    const ok = await this.d.rpc.send<boolean>("hardhat_dropTransaction", [hash]);
    if (!ok) throw new LabError(409, "not_pending", "The node no longer holds that transaction");
    this.d.watcher.markDropped(hash);
    return { hash, dropped: true };
  }

  /**
   * Replaces a pending transaction by sending another with the same nonce and a higher fee.
   * cancel: a 0-ETH transfer to the sender themself, so the original never executes.
   * speedUp: the same call again with a higher fee.
   * Works for accounts the node holds unlocked (the dev accounts).
   */
  async replaceTx(hash: string, mode: "cancel" | "speedUp"): Promise<{ original: string; replacement: string; mode: string }> {
    const tx = await this.pendingTx(hash);
    const bump = (v: string | undefined, fallback: bigint) => ((v ? toBig(v) : fallback) * 2n + 1n);
    const base = tx.gasPrice ? toBig(tx.gasPrice) : 1_000_000_000n;
    const maxFee = bump(tx.maxFeePerGas, base);
    const prio = bump(tx.maxPriorityFeePerGas, base / 2n);

    const request =
      mode === "cancel"
        ? { from: tx.from, to: tx.from, value: "0x0", gas: "0x5208" }
        : { from: tx.from, to: tx.to, value: tx.value, data: tx.input, gas: tx.gas };

    let replacement: string;
    try {
      replacement = await this.d.rpc.send<string>("eth_sendTransaction", [
        { ...request, nonce: tx.nonce, maxFeePerGas: toHexQuantity(maxFee), maxPriorityFeePerGas: toHexQuantity(prio) },
      ]);
    } catch (e) {
      throw new LabError(400, "cannot_replace", `The node could not send the replacement: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
    await this.d.watcher.poll();
    return { original: hash, replacement, mode };
  }

  // ───────────────────────── snapshots ─────────────────────────
  //
  // evm_snapshot ids are single-use: after evm_revert the id is gone, and every snapshot taken after
  // it is invalid too. So a restore immediately takes a fresh snapshot under the same name, and drops
  // the names that were created later.

  private readSnapshots(): SnapshotRecord[] {
    const raw = this.d.repo.getMeta("lab_snapshots");
    return raw ? (JSON.parse(raw) as SnapshotRecord[]) : [];
  }

  private writeSnapshots(list: SnapshotRecord[]): void {
    this.d.repo.setMeta("lab_snapshots", JSON.stringify(list));
  }

  listSnapshots(): SnapshotRecord[] {
    return this.readSnapshots();
  }

  async snapshot(name: string): Promise<SnapshotRecord> {
    this.checkSnapshotName(name);
    const id = await this.d.rpc.send<string>("evm_snapshot");
    const block = Number(BigInt(await this.d.rpc.send<string>("eth_blockNumber")));
    const record: SnapshotRecord = { name, id, block, createdAt: Date.now() };
    // Replacing a name also invalidates anything taken after the old one.
    const list = this.readSnapshots();
    const at = list.findIndex((s) => s.name === name);
    this.writeSnapshots([...(at >= 0 ? list.slice(0, at) : list), record]);
    return record;
  }

  async restore(name: string): Promise<{ name: string; headBlock: number; snapshot: SnapshotRecord }> {
    this.checkSnapshotName(name);
    const list = this.readSnapshots();
    const at = list.findIndex((s) => s.name === name);
    if (at < 0) throw new LabError(404, "not_found", `No snapshot named '${name}'`);

    const ok = await this.d.rpc.send<boolean>("evm_revert", [list[at]!.id]);
    if (!ok) {
      this.writeSnapshots(list.filter((s) => s.name !== name));
      throw new LabError(409, "snapshot_invalid", `Snapshot '${name}' is no longer valid (the node was reset or an earlier snapshot was restored)`);
    }

    // Reverting also undid any direct storage edits made after the snapshot.
    for (const group of this.d.repo.activeTamperGroups()) this.d.repo.markTamperUndone(group, Date.now());

    const fresh = await this.snapshot(name); // ids are single-use
    const kept = this.readSnapshots().filter((s) => list.findIndex((x) => x.name === s.name) <= at);
    this.writeSnapshots(kept);

    await this.settle();
    await this.d.indexer.rescanStorage();
    const headBlock = Number(BigInt(await this.d.rpc.send<string>("eth_blockNumber")));
    this.d.bus.publish("lab.restored", { kind: "snapshot", name, headBlock });
    return { name, headBlock, snapshot: fresh };
  }

  private checkSnapshotName(name: string): void {
    if (!/^[\w-]{1,40}$/.test(name)) throw new LabError(400, "bad_request", "A snapshot name is 1 to 40 letters, digits, '-' or '_'");
  }

  // ───────────────────────── client tracking ─────────────────────────
  //
  // Manual mining leaves transactions waiting. If every browser tab closes while the chain is paused,
  // a wallet that later connects would hang, so the chain returns to automine shortly after the last
  // client disconnects.

  clientConnected(): void {
    this.clients++;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  clientDisconnected(): void {
    this.clients = Math.max(0, this.clients - 1);
    if (this.clients > 0 || this.graceTimer) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.clients === 0) void this.restoreAutomine();
    }, this.d.config.LAB_GRACE_MS);
  }

  get connectedClients(): number {
    return this.clients;
  }

  private async restoreAutomine(): Promise<void> {
    try {
      if ((await this.availability()).available && !(await this.mining()).automine) {
        this.d.log.info("no clients left: switching the node back to automine");
        await this.setMining("auto");
        await this.settle();
      }
    } catch (e) {
      this.d.log.warn(`could not restore automine: ${e instanceof Error ? e.message : e}`);
    }
  }

  dispose(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }
}
