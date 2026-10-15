import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { Action, buildFieldWrite, compareWithContract, computeHash, recordSlot, word, type RecordMember } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { Bus } from "../src/bus";
import { createRpc } from "../src/chain/rpc";
import { Repo } from "../src/db/repo";
import { Indexer } from "../src/indexer/indexer";
import { silentLogger } from "../src/logger";
import { VerificationService, rowToRecord } from "../src/verification";
import { makeDeployment, deployContracts } from "@dpp/shared/testing";

/** Writes one field of a stored record directly into contract storage (what the lab will do). */
async function tamper(h: Harness, index: number, field: RecordMember, value: bigint) {
  const address = await h.deployed.market.getAddress();
  const slot = recordSlot(index, field);
  const current = BigInt(await h.rpc.send<string>("eth_getStorageAt", [address, word(slot), "latest"]));
  const w = buildFieldWrite(index, field, value, current);
  await h.rpc.send("hardhat_setStorageAt", [address, word(w.slot), word(w.value)]);
}

const contractVerdict = async (h: Harness) => (await h.indexer.onChainVerdict())!;

describe("indexer: tampering is visible after a storage rescan", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    await h.call(1, "listForSale", 1, eth("2"));
    await h.call(1, "cancelListing", 1);
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("is intact before anyone touches it", async () => {
    expect(h.verification.summary()).toMatchObject({ valid: true, recordCount: 5 });
  });

  it("does not notice a storage edit until it rescans (no new block was mined)", async () => {
    await tamper(h, 2, "price", 999n);
    await h.indexer.syncOnce();
    expect(h.verification.summary().valid).toBe(true); // still the old copy
  });

  it("level 1: a data edit flags only that record, and agrees with the contract", async () => {
    const changed = await h.indexer.rescanStorage();
    expect(changed).toEqual([2n]);
    const s = h.verification.summary();
    expect(s).toMatchObject({ valid: false, firstBrokenAt: "2", brokenIndexes: ["2"] });
    const check = h.verification.get().checks[2]!;
    expect(check.status).toBe("dataTampered");

    const verdict = await contractVerdict(h);
    expect(verdict.valid).toBe(false);
    expect(verdict.brokenAt).toBe(2n);
    expect(compareWithContract(h.verification.get(), verdict)).toMatchObject({ agree: true, contractFooled: false });
  });

  it("publishes verification.changed when the verdict flips", () => {
    const m = h.bus.since(0)!.filter((x) => x.type === "verification.changed").at(-1)!;
    expect(m.data).toMatchObject({ valid: false, brokenIndexes: ["2"] });
  });

  it("repairing the record and rescanning restores the verdict", async () => {
    await tamper(h, 2, "price", eth("1"));
    expect(await h.indexer.rescanStorage()).toEqual([2n]);
    expect(h.verification.summary().valid).toBe(true);
  });

  it("level 3: a self-consistent rewrite of the tail fools the contract but not the event log", async () => {
    // Rewrite records 2..4 so every hash and link is internally consistent.
    const records = (await Promise.all([0, 1, 2, 3, 4].map(async (i) => rowToRecord(h.repo.getRecord(i)!)))).map((r) => ({ ...r }));
    records[2]!.price = 12345n;
    for (let i = 2; i < records.length; i++) {
      if (i > 2) records[i]!.prevHash = records[i - 1]!.hash;
      records[i]!.hash = computeHash(records[i]!);
    }
    for (let i = 2; i < records.length; i++) {
      await tamper(h, i, "price", records[i]!.price);
      await tamper(h, i, "prevHash", BigInt(records[i]!.prevHash));
      await tamper(h, i, "hash", BigInt(records[i]!.hash));
    }
    await h.indexer.rescanStorage();

    const verdict = await contractVerdict(h);
    expect(verdict.valid).toBe(true); // the contract is fooled
    const result = h.verification.get();
    expect(result.firstBrokenOnChainAt).toBeNull();
    expect(result.firstBrokenAt).toBe(2n); // but the RecordAppended logs still hold the original hashes
    expect(result.checks.slice(2).every((c) => c.status === "anchorMismatch")).toBe(true);
    expect(result.checks.slice(0, 2).every((c) => c.status === "intact")).toBe(true);
    expect(compareWithContract(result, verdict)).toMatchObject({ agree: true, contractFooled: true });
  });
});

describe("indexer: the chain moves backwards (evm_revert)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("forgets reverted blocks, then indexes the new history that reuses their numbers", async () => {
    await h.call(0, "registerProduct", "Laptop");
    await h.indexer.syncOnce();
    const snapshot = await h.rpc.send<string>("evm_snapshot");

    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(0, "registerProduct", "Phone");
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(3);
    const doomedBlock = h.repo.latestBlock()!;
    const doomedTx = h.repo.listTxs({ limit: 1 })[0]!.hash;

    expect(await h.rpc.send("evm_revert", [snapshot])).toBe(true);
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(1);
    expect(h.repo.getTx(doomedTx)).toBeNull();
    expect(h.repo.getProduct(2)).toBeNull();
    expect(h.bus.since(0)!.some((m) => m.type === "chain.rewound")).toBe(true);
    const rewound = h.bus.since(0)!.filter((m) => m.type === "chain.rewound").at(-1)!;
    expect(rewound.data).toMatchObject({ fromBlock: doomedBlock.number });

    // New history at the same block heights, with different content.
    await h.call(1, "registerProduct", "Tablet");
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(2);
    expect(h.repo.getRecord(1)!.action).toBe(Action.Registered);
    expect(h.repo.getRecord(1)!.actor.toLowerCase()).toBe(h.deployment.roles[1]!.address.toLowerCase());
    expect(h.repo.getProduct(2)!.name).toBe("Tablet");
    expect(h.repo.latestBlock()!.number).toBe(doomedBlock.number - 1);
    expect(h.verification.summary()).toMatchObject({ valid: true, recordCount: 2 });
  });

  it("copes with a revert to the very start (snapshot taken before any activity)", async () => {
    const snapshot = await h.rpc.send<string>("evm_snapshot");
    await h.call(2, "registerProduct", "Watch");
    await h.indexer.syncOnce();
    const before = h.repo.recordCount();
    await h.rpc.send("evm_revert", [snapshot]);
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(before - 1);
  });
});

describe("indexer: sessions and deployments", () => {
  const open: Harness[] = [];
  afterEach(async () => { while (open.length) await open.pop()!.stop(); });
  const harness = async () => { const h = await startHarness(); open.push(h); return h; };

  it("starts over when the node was restarted (a different genesis block)", async () => {
    const a = await harness();
    await a.call(0, "registerProduct", "Laptop");
    await a.indexer.syncOnce();
    expect(a.repo.recordCount()).toBe(1);

    // "Restarted node": same index database, but the node now has another genesis hash.
    const b = await harness();
    await b.call(0, "registerProduct", "Phone");
    await b.call(0, "registerProduct", "Tablet");
    const verification = new VerificationService(a.repo, a.bus);
    const indexer = new Indexer({ rpc: b.rpc, repo: a.repo, bus: a.bus, log: silentLogger, getDeployment: () => b.deployment, verification });
    const report = await indexer.syncOnce();

    expect(report.reset).toBe(true);
    expect(a.repo.getMeta("session_id")).toBe(b.deployment.sessionId);
    expect(a.repo.recordCount()).toBe(2);
    expect(a.repo.getProduct(1)!.name).toBe("Phone"); // none of the old chain's data is left
    expect(a.bus.since(0)!.some((m) => m.type === "chain.reset")).toBe(true);
  });

  it("starts over when the contract is redeployed on the same chain", async () => {
    const h = await harness();
    await h.call(0, "registerProduct", "Old contract item");
    await h.indexer.syncOnce();

    const second = await deployContracts(h.node.provider);
    const deployment2 = await makeDeployment(h.node.provider, second);
    await (second.market.connect(second.signers[0]!) as never as { registerProduct: (n: string) => Promise<{ wait: () => Promise<unknown> }> })
      .registerProduct("New contract item").then((t) => t.wait());

    const indexer = new Indexer({ rpc: h.rpc, repo: h.repo, bus: h.bus, log: silentLogger, getDeployment: () => deployment2, verification: h.verification });
    const report = await indexer.syncOnce();
    expect(report.reset).toBe(true);
    expect(h.repo.recordCount()).toBe(1);
    expect(h.repo.getProduct(1)!.name).toBe("New contract item");
  });

  it("waits for a deployment instead of failing", async () => {
    const h = await harness();
    const indexer = new Indexer({ rpc: h.rpc, repo: h.repo, bus: h.bus, log: silentLogger, getDeployment: () => null });
    const report = await indexer.syncOnce();
    expect(report.state).toBe("waiting-for-deploy");
    expect(indexer.status().message).toMatch(/dev:deploy/);
  });

  it("waits when the deployment file belongs to another node", async () => {
    const a = await harness();
    const b = await harness();
    const indexer = new Indexer({ rpc: b.rpc, repo: b.repo, bus: b.bus, log: silentLogger, getDeployment: () => a.deployment });
    expect((await indexer.syncOnce()).state).toBe("waiting-for-deploy");
  });

  it("waits for the node when it is down, then recovers", async () => {
    const h = await harness();
    const dead = createRpc("http://127.0.0.1:1", { retries: 0 });
    const indexer = new Indexer({ rpc: dead, repo: h.repo, bus: h.bus, log: silentLogger, getDeployment: () => h.deployment });
    const report = await indexer.syncOnce();
    expect(report.state).toBe("waiting-for-node");
    expect(indexer.status().message).toMatch(/dev:node/);
    dead.destroy();
  });

  it("resumes where it left off after a restart of the backend, without duplicates", async () => {
    const h = await harness();
    const dir = mkdtempSync(join(tmpdir(), "resume-"));
    try {
      const path = join(dir, "index.sqlite");
      await h.call(0, "registerProduct", "Laptop");
      await h.call(0, "listForSale", 1, eth("1"));

      const repo1 = Repo.open(path);
      const first = new Indexer({ rpc: h.rpc, repo: repo1, bus: new Bus(), log: silentLogger, getDeployment: () => h.deployment, verification: new VerificationService(repo1, new Bus()) });
      await first.syncOnce();
      const blocksAfterFirst = repo1.latestBlock()!.number;
      repo1.close();

      await h.call(1, "registerProduct", "Phone");

      const repo2 = Repo.open(path);
      const second = new Indexer({ rpc: h.rpc, repo: repo2, bus: new Bus(), log: silentLogger, getDeployment: () => h.deployment, verification: new VerificationService(repo2, new Bus()) });
      const report = await second.syncOnce();
      expect(report.reset).toBe(false);
      expect(report.fromBlock).toBe(blocksAfterFirst + 1);
      expect(report.blocks).toBe(1);
      expect(repo2.recordCount()).toBe(3);
      expect(repo2.countTxs()).toBe(repo2.listTxs({ limit: 1000 }).length);
      expect(repo2.productCount()).toBe(2);
      repo2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows the chain on its own while started, and stops cleanly", async () => {
    const h = await harness();
    h.indexer.start();
    await h.call(0, "registerProduct", "Laptop");
    const deadline = Date.now() + 8000;
    // the record is copied part-way through a pass; "live" is announced when that pass finishes
    while ((h.repo.recordCount() < 1 || h.indexer.status().state !== "live") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(h.repo.recordCount()).toBe(1);
    expect(h.indexer.status().state).toBe("live");
    await h.indexer.stop();
    expect(h.indexer.status().state).toBe("stopped");
  });
});

