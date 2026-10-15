import type { Bus } from "../bus";
import type { Rpc } from "../chain/rpc";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Indexer } from "../indexer/indexer";
import type { MempoolWatcher } from "../lifecycle/mempoolWatcher";
import type { Logger } from "../logger";
import type { VerificationService } from "../verification";
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
