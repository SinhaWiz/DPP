import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, eth, type Harness } from "./helpers";

describe("indexer: sessions, blocks and transactions", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("indexes the deployment blocks even though they contain no market calls", async () => {
    const report = await h.indexer.syncOnce();
    expect(report.state).toBe("live");
    expect(report.reset).toBe(false);
    expect(h.indexer.status().sessionId).toBe(h.deployment.sessionId);
    expect(h.repo.getMeta("deployment_key")).toContain(h.deployment.contracts.market.address.toLowerCase());
    // the first block we look at is the market's deploy block
    expect(h.repo.getBlock(h.deployment.deployBlock)).not.toBeNull();
  });

  it("decodes calls to the market: function name and arguments", async () => {
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    const report = await h.indexer.syncOnce();
    expect(report.blocks).toBe(3);
    expect(report.txs).toBe(3);

    const txs = h.repo.listTxs({ limit: 10 }).filter((t) => t.functionName);
    expect(txs.map((t) => t.functionName)).toEqual(["buy", "listForSale", "registerProduct"]);
    const buy = txs[0]!;
    expect(buy.args).toEqual({ productId: "1" });
    expect(buy.value).toBe(eth("1").toString());
    expect(buy.status).toBe(1);
    expect(buy.lifecycleState).toBe("mined");
    expect(buy.gasUsed).toMatch(/^\d+$/);
    expect(txs[2]!.args).toEqual({ name: "Laptop" });
    expect(buy.from.toLowerCase()).toBe(h.deployment.roles[1]!.address.toLowerCase());
  });

  it("decodes the events of every transaction", async () => {
    const buy = h.repo.listTxs({ limit: 10 }).find((t) => t.functionName === "buy")!;
    const names = h.repo.eventsForTx(buy.hash).map((e) => e.name);
    expect(names).toEqual(["RecordAppended", "ProductSold"]);
    const appended = h.repo.eventsForTx(buy.hash)[0]!;
    expect(appended.args.index).toBe("2"); // records 0 (Registered), 1 (Listed), 2 (Sold)
    expect(appended.args.action).toBe("3");
    expect(appended.args.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(appended.args.prevHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("marks a reverted transaction as failed and records its gas, with no events", async () => {
    const hash = await h.callFailing(4, "listForSale", 1, eth("1")); // outsider is not the owner
    await h.indexer.syncOnce();
    const t = h.repo.getTx(hash)!;
    expect(t.status).toBe(0);
    expect(t.lifecycleState).toBe("failed");
    expect(t.functionName).toBe("listForSale");
    expect(BigInt(t.gasUsed!)).toBeGreaterThan(0n);
    expect(h.repo.eventsForTx(hash)).toEqual([]);
  });

  it("is idempotent: a second pass finds nothing new", async () => {
    const before = h.repo.countTxs();
    const report = await h.indexer.syncOnce();
    expect(report.blocks).toBe(0);
    expect(h.repo.countTxs()).toBe(before);
  });

  it("shares one pass between concurrent callers", async () => {
    const [a, b] = await Promise.all([h.indexer.syncOnce(), h.indexer.syncOnce()]);
    expect(a).toBe(b);
  });

  it("publishes block and transaction messages", async () => {
    const seen: string[] = [];
    h.bus.subscribe((m) => ["block.new", "tx.mined", "tx.failed"].includes(m.type) && seen.push(m.type));
    await h.call(0, "registerProduct", "Phone");
    await h.callFailing(4, "listForSale", 2, eth("1"));
    await h.indexer.syncOnce();
    expect(seen).toEqual(["block.new", "tx.mined", "block.new", "tx.failed"]);
    // and the indexer announces when it is syncing and when it is caught up again
    expect(h.bus.since(0)!.some((m) => m.type === "indexer.status")).toBe(true);
  });

  it("recognises a mined transaction to the rejecter contract", async () => {
    const rejecter = h.deployed.rejecter.connect(h.deployed.signers[0]!) as unknown as { registerOn: (a: string) => Promise<{ wait: () => Promise<unknown> }> };
    await (await rejecter.registerOn(await h.deployed.market.getAddress())).wait();
    await h.indexer.syncOnce();
    const t = h.repo.listTxs({ limit: 1 })[0]!;
    expect(t.functionName).toBe("registerOn");
    expect(t.to!.toLowerCase()).toBe(h.deployment.contracts.rejecter.address.toLowerCase());
  });
});
