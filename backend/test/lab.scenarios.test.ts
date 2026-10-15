import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Action, customErrorNames, ErrorSchema, SessionSchema } from "@dpp/shared";
import { startDevNode, type DevNode } from "@dpp/shared/testing";
import { startHarness, type Harness } from "./helpers";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createServices } from "../src/services";

interface Run { name: string; steps: string[]; result: Record<string, any> }

describe("lab: scenarios", () => {
  let h: Harness;
  const run = (name: string, body?: object) => h.post<Run>(`/api/lab/scenarios/${name}`, body ?? {});
  const actions = (id: number | string) => h.repo.listRecords({ productId: BigInt(id) }).map((r) => r.action);

  beforeAll(async () => { h = await startHarness(); await h.indexer.syncOnce(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("lists the available scenarios", async () => {
    const { body } = await h.get<{ scenarios: { name: string }[] }>("/api/lab/scenarios");
    expect(body.scenarios.map((s) => s.name)).toEqual(["supplyChain", "escrowRevocations", "everyError", "bulk"]);
  });

  it("supplyChain: a laptop reaches the customer through three sales, fully traced", async () => {
    const { status, body } = await run("supplyChain");
    expect(status).toBe(200);
    expect(body.steps.length).toBeGreaterThanOrEqual(4);
    const id = body.result.productId;
    expect(actions(id)).toEqual([Action.Registered, Action.Listed, Action.Sold, Action.Listed, Action.Sold, Action.Listed, Action.Sold]);
    expect(h.repo.getProduct(BigInt(id))!.owner.toLowerCase()).toBe(h.deployment.roles[3]!.address.toLowerCase());
    expect(h.verification.summary().valid).toBe(true);
  });

  it("escrowRevocations: confirmed, rejected and expired reservations, and everyone withdraws", async () => {
    const before = h.repo.recordCount();
    const { body } = await run("escrowRevocations");
    const { phone, tablet, watch } = body.result;
    expect(actions(phone)).toEqual([Action.Registered, Action.Listed, Action.Delisted, Action.Listed, Action.Reserved, Action.Revoked, Action.Reserved, Action.Sold]);
    expect(actions(tablet)).toEqual([Action.Registered, Action.Listed, Action.Reserved, Action.Revoked]);
    expect(actions(watch)).toEqual([Action.Registered, Action.Listed, Action.Reserved, Action.Revoked]);
    expect(h.repo.recordCount()).toBe(before + 16);
    expect(h.verification.summary().valid).toBe(true);
    // the reservation really expired because the chain's clock was moved, not because anyone waited
    const expiry = h.repo.listRecords({ productId: BigInt(watch) }).at(-1)!;
    expect(expiry.timestamp).toBeGreaterThan(h.repo.getRecord(BigInt(h.repo.recordCount() - 1))!.timestamp - 1n);
  });

  it("everyError: a mined, explained failure for every custom error a transaction can raise", async () => {
    const before = h.repo.recordCount();
    const { body } = await run("everyError");
    expect(body.result.attempts).toBeGreaterThanOrEqual(15);
    expect(body.result.mined).toBe(body.result.attempts); // every one was mined with status 0 (DEV_NODE)

    const failed = h.repo.listTxs({ state: "failed", limit: 100 });
    expect(failed.length).toBe(body.result.attempts);
    const names = new Set(failed.map((t) => t.revertName));
    const reachable = customErrorNames.filter((n) => !["RecordNotFound", "InvalidRange"].includes(n)); // these only come from read calls
    for (const n of reachable) expect(names.has(n), `missing ${n}`).toBe(true);
    expect(failed.every((t) => t.revertApprox === false)).toBe(true);

    // the scenario's own setup wrote records; the failures wrote none
    const added = h.repo.listRecords({ offset: before, limit: 1000 });
    expect(added.every((r) => [Action.Registered, Action.Listed, Action.Reserved, Action.Revoked].includes(r.action as never))).toBe(true);
    expect(h.verification.summary().valid).toBe(true);
  });

  it("bulk: two records per product, with a limit on the count", async () => {
    const before = h.repo.recordCount();
    const { body } = await run("bulk", { count: 5 });
    expect(body.result).toEqual({ count: 5, records: 10 });
    expect(h.repo.recordCount()).toBe(before + 10);
    expect((await run("bulk", { count: 0 })).status).toBe(400);
    expect((await run("bulk", { count: 9999 })).status).toBe(400);
  });

  it("publishes progress while it runs", async () => {
    const before = h.bus.lastSeq;
    await run("bulk", { count: 1 });
    const msgs = h.bus.since(before)!.filter((m) => m.type === "lab.scenario");
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.at(-1)!.data).toMatchObject({ name: "bulk", done: true });
  });

  it("rejects an unknown scenario, a second one at the same time, and a paused chain", async () => {
    const unknown = await run("nope");
    expect(unknown.status).toBe(404);
    expect(ErrorSchema.parse(unknown.body).error.message).toContain("Known:");

    const [a, b] = await Promise.all([run("bulk", { count: 4 }), run("bulk", { count: 4 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(ErrorSchema.parse((a.status === 409 ? a : b).body).error.code).toBe("busy");

    await h.post("/api/lab/mining", { mode: "manual" });
    const paused = await run("supplyChain");
    expect(paused.status).toBe(409);
    expect(ErrorSchema.parse(paused.body).error.code).toBe("needs_automine");
    await h.post("/api/lab/mining", { mode: "auto" });
  });
});

describe("lab: reset (redeploys by running the real deploy and seed scripts)", () => {
  let node: DevNode;
  let dir: string;
  let services: ReturnType<typeof createServices>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const post = async (url: string, payload?: object) => {
    const r = await app.inject({ method: "POST", url, payload: payload as never });
    return { status: r.statusCode, body: r.json() };
  };
  const get = async (url: string) => (await app.inject({ method: "GET", url })).json();

  beforeAll(async () => {
    node = await startDevNode();
    dir = mkdtempSync(join(tmpdir(), "reset-"));
    const config = loadConfig({}, {
      RPC_URL: node.url, DB_PATH: ":memory:", LOG_LEVEL: "silent", POLL_MS: 50, DEPLOYMENT_PATH: join(dir, "deployment.json"),
    });
    services = createServices(config);
    app = await buildApp(services);
  }, 90_000);
  afterAll(async () => {
    await app?.close();
    await services?.stop();
    await node?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("waits for a deployment, then deploys on request", async () => {
    await services.indexer.syncOnce();
    expect(SessionSchema.parse(await get("/api/session")).indexer.state).toBe("waiting-for-deploy");

    const res = await post("/api/lab/reset", { seed: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(existsSync(join(dir, "deployment.json"))).toBe(true);

    const session = SessionSchema.parse(await get("/api/session"));
    expect(session.indexer.state).toBe("live");
    expect(session.contracts).not.toBeNull();
    expect(session.ledgerLength).toBe(0);
  }, 120_000);

  it("seeds the sample data when asked", async () => {
    const res = await post("/api/lab/reset", { seed: true, withFailures: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const session = SessionSchema.parse(await get("/api/session"));
    expect(session.ledgerLength).toBeGreaterThan(30);
    expect(session.productCount).toBeGreaterThanOrEqual(8);
    expect(services.verification.summary().valid).toBe(true);
    expect(services.repo.countTxs("failed")).toBe(15); // one per custom error a transaction can raise
  }, 180_000);

  it("starts over on the next reset: the old index, snapshots and attacks are gone", async () => {
    await post("/api/lab/snapshots", { name: "before-reset" });
    const seqBefore = services.bus.lastSeq;

    const res = await post("/api/lab/reset", { seed: false });
    expect(res.status).toBe(200);
    expect(services.bus.since(seqBefore)!.some((m) => m.type === "chain.reset")).toBe(true);
    const session = SessionSchema.parse(await get("/api/session"));
    expect(session.ledgerLength).toBe(0);
    expect(services.repo.countTxs("failed")).toBe(0);
    expect(services.lab.listSnapshots()).toEqual([]);
  }, 120_000);
});
