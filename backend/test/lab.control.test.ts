import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract } from "ethers";
import { ErrorSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";

describe("lab: dropping and replacing pending transactions", () => {
  let h: Harness;
  const sendAs = (signer: number, fn: string, ...args: unknown[]) =>
    (h.deployed.market.connect(h.deployed.signers[signer]!) as Contract).getFunction(fn)(...args);

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
    await h.post("/api/lab/mining", { mode: "manual" });
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("drops a pending transaction: it is never mined and writes no record", async () => {
    const tx = await sendAs(1, "buy", 1, { value: eth("1") });
    await h.watcher.poll();
    const res = await h.post<{ dropped: boolean }>(`/api/lab/txs/${tx.hash}/drop`);
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("dropped");

    await h.post("/api/lab/mine", {});
    expect(h.repo.getTx(tx.hash)).toMatchObject({ lifecycleState: "dropped", blockNumber: null });
    expect(h.repo.recordCount()).toBe(2);
    expect(h.repo.getProduct(1)!.owner.toLowerCase()).toBe(h.deployment.roles[0]!.address.toLowerCase());
  });

  it("cancels a pending transaction by replacing it with a 0-ETH self-transfer", async () => {
    const original = await sendAs(1, "buy", 1, { value: eth("1") });
    await h.watcher.poll();

    const res = await h.post<{ original: string; replacement: string; mode: string }>(`/api/lab/txs/${original.hash}/replace`, { mode: "cancel" });
    expect(res.status).toBe(200);
    expect(res.body.original).toBe(original.hash);
    expect(h.repo.getTx(original.hash)).toMatchObject({ lifecycleState: "replaced", replacedBy: res.body.replacement });

    await h.post("/api/lab/mine", {});
    const replacement = h.repo.getTx(res.body.replacement)!;
    expect(replacement).toMatchObject({ lifecycleState: "mined", value: "0", functionName: null });
    expect(replacement.to!.toLowerCase()).toBe(replacement.from.toLowerCase());
    expect(h.repo.getTx(original.hash)).toMatchObject({ lifecycleState: "replaced", blockNumber: null });
    expect(h.repo.recordCount()).toBe(2); // the purchase never happened
  });

  it("speeds up a pending transaction: the same call, a higher fee, executed once", async () => {
    const original = await sendAs(2, "registerProduct", "Speedy");
    await h.watcher.poll();
    const originalFee = BigInt(h.repo.getTx(original.hash)!.maxFee!);

    const res = await h.post<{ replacement: string }>(`/api/lab/txs/${original.hash}/replace`, { mode: "speedUp" });
    expect(res.status).toBe(200);
    await h.post("/api/lab/mine", {});

    const replacement = h.repo.getTx(res.body.replacement)!;
    expect(replacement).toMatchObject({ lifecycleState: "mined", functionName: "registerProduct", args: { name: "Speedy" } });
    expect(BigInt(replacement.maxFee!)).toBeGreaterThan(originalFee);
    expect(h.repo.getTx(original.hash)!.lifecycleState).toBe("replaced");
    expect(h.repo.productCount()).toBe(2); // registered exactly once
    expect(h.repo.getProduct(2)!.name).toBe("Speedy");
  });

  it("refuses to drop or replace a transaction that is already mined", async () => {
    const mined = h.repo.listTxs({ state: "mined", limit: 1 })[0]!;
    for (const [url, payload] of [[`/api/lab/txs/${mined.hash}/drop`, undefined], [`/api/lab/txs/${mined.hash}/replace`, { mode: "cancel" }]] as const) {
      const r = await h.post(url, payload);
      expect(r.status).toBe(409);
      expect(ErrorSchema.parse(r.body).error.code).toBe("not_pending");
    }
  });

  it("404s for an unknown hash and 400s for a malformed one or a bad mode", async () => {
    expect((await h.post(`/api/lab/txs/0x${"ab".repeat(32)}/drop`)).status).toBe(404);
    expect((await h.post("/api/lab/txs/0x12/drop")).status).toBe(400);
    const tx = await sendAs(3, "registerProduct", "X");
    expect((await h.post(`/api/lab/txs/${tx.hash}/replace`, { mode: "explode" })).status).toBe(400);
    await h.post(`/api/lab/txs/${tx.hash}/drop`);
  });
});

describe("lab: snapshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("restores the chain to a named snapshot and the index follows", async () => {
    const snap = await h.post<{ name: string; block: number }>("/api/lab/snapshots", { name: "start" });
    expect(snap.body).toMatchObject({ name: "start", block: h.repo.latestBlock()!.number });

    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(3);

    const r = await h.post<{ headBlock: number }>("/api/lab/restore", { name: "start" });
    expect(r.status).toBe(200);
    expect(r.body.headBlock).toBe(snap.body.block);
    expect(h.repo.recordCount()).toBe(1);
    expect(h.repo.getProduct(1)!.price).toBe(0n);
    expect(h.bus.since(0)!.some((m) => m.type === "lab.restored")).toBe(true);
    expect(h.bus.since(0)!.some((m) => m.type === "chain.rewound")).toBe(true);
  });

  it("can restore the same snapshot again, because a restore takes a fresh one", async () => {
    await h.call(2, "registerProduct", "Second attempt");
    await h.indexer.syncOnce();
    expect(h.repo.recordCount()).toBe(2);
    expect((await h.post("/api/lab/restore", { name: "start" })).status).toBe(200);
    expect(h.repo.recordCount()).toBe(1);
    expect((await h.get<{ snapshots: { name: string }[] }>("/api/lab/snapshots")).body.snapshots.map((s) => s.name)).toEqual(["start"]);
  });

  it("drops snapshots taken after the one that is restored", async () => {
    await h.call(0, "registerProduct", "Phone");
    await h.post("/api/lab/snapshots", { name: "middle" });
    await h.call(0, "registerProduct", "Tablet");
    await h.post("/api/lab/snapshots", { name: "late" });
    expect((await h.get<{ snapshots: unknown[] }>("/api/lab/snapshots")).body.snapshots).toHaveLength(3);

    await h.post("/api/lab/restore", { name: "middle" });
    const names = (await h.get<{ snapshots: { name: string }[] }>("/api/lab/snapshots")).body.snapshots.map((s) => s.name);
    expect(names).toEqual(["start", "middle"]);
    expect((await h.post("/api/lab/restore", { name: "late" })).status).toBe(404);
  });

  it("re-taking a name replaces it and discards the ones after it", async () => {
    await h.post("/api/lab/snapshots", { name: "start" });
    expect((await h.get<{ snapshots: { name: string }[] }>("/api/lab/snapshots")).body.snapshots.map((s) => s.name)).toEqual(["start"]);
  });

  it("validates names and reports unknown snapshots", async () => {
    for (const name of ["", "has space", "x".repeat(41), "a/b"]) {
      expect((await h.post("/api/lab/snapshots", { name })).status, name).toBe(400);
    }
    const r = await h.post("/api/lab/restore", { name: "nope" });
    expect(r.status).toBe(404);
  });

  it("reports a snapshot the node no longer knows as invalid and forgets it", async () => {
    await h.post("/api/lab/snapshots", { name: "stale" });
    await h.rpc.send("evm_revert", [h.services.lab.listSnapshots().find((s) => s.name === "stale")!.id]); // consumed behind the lab's back
    const r = await h.post("/api/lab/restore", { name: "stale" });
    expect(r.status).toBe(409);
    expect(ErrorSchema.parse(r.body).error.code).toBe("snapshot_invalid");
    expect(h.services.lab.listSnapshots().map((s) => s.name)).not.toContain("stale");
  });
});
