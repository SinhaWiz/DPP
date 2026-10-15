import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { labAvailability } from "../src/lab/guard";
import { loadConfig } from "../src/config";
import { Contract } from "ethers";

describe("lab guard", () => {
  const cfg = (host: string) => loadConfig({}, { HOST: host });
  it("allows only the local dev chain on a loopback address", () => {
    expect(labAvailability(cfg("127.0.0.1"), 31337)).toEqual({ available: true, reason: null });
    expect(labAvailability(cfg("localhost"), 31337).available).toBe(true);
    expect(labAvailability(cfg("::1"), 31337).available).toBe(true);
  });
  it("explains why it is off", () => {
    expect(labAvailability(cfg("127.0.0.1"), 11155111).reason).toContain("11155111");
    expect(labAvailability(cfg("0.0.0.0"), 31337).reason).toContain("0.0.0.0");
    expect(labAvailability(cfg("127.0.0.1"), null).available).toBe(false);
  });
});

describe("lab: mining and time", () => {
  let h: Harness;
  const market = () => h.deployed.market;
  const sendAs = (signer: number, fn: string, ...args: unknown[]) =>
    (market().connect(h.deployed.signers[signer]!) as Contract).getFunction(fn)(...args);

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("reports automine by default", async () => {
    const { status, body } = await h.get<{ mining: { mode: string; automine: boolean }; clients: number }>("/api/lab/status");
    expect(status).toBe(200);
    expect(body.mining).toEqual({ mode: "auto", automine: true, intervalMs: null });
  });

  it("manual mode holds transactions until a block is mined", async () => {
    const res = await h.post<{ mode: string }>("/api/lab/mining", { mode: "manual" });
    expect(res.body.mode).toBe("manual");
    expect(h.bus.since(0)!.some((m) => m.type === "mining.changed")).toBe(true);

    const tx = await sendAs(1, "buy", 1, { value: eth("1") });
    await h.watcher.poll();
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("pending");
    expect(h.repo.recordCount()).toBe(2);

    const mined = await h.post<{ mined: number; headBlock: number }>("/api/lab/mine", {});
    expect(mined.status).toBe(200);
    expect(mined.body.mined).toBe(1);
    // the response is only returned after the indexer caught up
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("mined");
    expect(h.repo.recordCount()).toBe(3);
    expect(h.repo.latestBlock()!.number).toBe(mined.body.headBlock);
  });

  it("mines several blocks at once and rejects silly amounts", async () => {
    const before = h.repo.latestBlock()!.number;
    expect((await h.post<{ headBlock: number }>("/api/lab/mine", { blocks: 3 })).body.headBlock).toBe(before + 3);
    for (const blocks of [0, 101, 1.5]) {
      const r = await h.post("/api/lab/mine", { blocks });
      expect(r.status, String(blocks)).toBe(400);
    }
  });

  it("interval mode mines on its own", async () => {
    const r = await h.post<{ mode: string; intervalMs: number }>("/api/lab/mining", { mode: "interval", intervalMs: 200 });
    expect(r.body).toMatchObject({ mode: "interval", intervalMs: 200 });
    const tx = await sendAs(2, "registerProduct", "Interval item");
    await tx.wait(); // resolves once the node's own timer mines it
    await h.indexer.syncOnce();
    expect(h.repo.getTx(tx.hash)!.lifecycleState).toBe("mined");
  });

  it("rejects an interval that is too short or missing", async () => {
    expect((await h.post("/api/lab/mining", { mode: "interval", intervalMs: 10 })).status).toBe(400);
    expect((await h.post("/api/lab/mining", { mode: "interval" })).status).toBe(400);
    expect((await h.post("/api/lab/mining", { mode: "sometimes" })).status).toBe(400);
  });

  it("returns to automine", async () => {
    const r = await h.post<{ mode: string; intervalMs: number | null }>("/api/lab/mining", { mode: "auto" });
    expect(r.body).toEqual({ mode: "auto", automine: true, intervalMs: null });
    await h.call(3, "registerProduct", "Auto again"); // would hang if automine were still off
  });

  it("moves the clock forward so a reservation can expire", async () => {
    // The earlier test in manual mode sold product 1 to the Distributor (role 1), who now relists it.
    await h.indexer.syncOnce();
    expect(h.repo.getProduct(1)!.owner.toLowerCase()).toBe(h.deployment.roles[1]!.address.toLowerCase());
    await h.call(1, "listForSale", 1, eth("1"));
    await h.call(2, "reserve", 1, { value: eth("1") }); // the Retailer reserves it

    const early = await h.callFailing(4, "expireReservation", 1);
    await h.indexer.syncOnce();
    expect(h.repo.getTx(early)!.revertName).toBe("ReservationNotExpired");

    const { status, body } = await h.post<{ timestamp: number }>("/api/lab/time", { seconds: 24 * 3600 + 5 });
    expect(status).toBe(200);
    const reservation = h.repo.getProduct(1)!;
    expect(BigInt(body.timestamp)).toBeGreaterThan(reservation.reservedExpires!);

    await h.call(4, "expireReservation", 1);
    await h.indexer.syncOnce();
    expect(h.repo.getProduct(1)!.reservedBy).toBeNull();
  });

  it("rejects an invalid time step", async () => {
    for (const seconds of [0, -5, 99999999]) expect((await h.post("/api/lab/time", { seconds })).status).toBe(400);
  });

  it("is switched off for every route when the API is not on loopback", async () => {
    const exposed = await startHarness();
    try {
      (exposed.config as { HOST: string }).HOST = "0.0.0.0";
      for (const [method, url] of [["get", "/api/lab/status"], ["post", "/api/lab/mine"], ["post", "/api/lab/mining"], ["post", "/api/lab/time"]] as const) {
        const r = method === "get" ? await exposed.get(url) : await exposed.post(url, {});
        expect(r.status, url).toBe(403);
        expect(ErrorSchema.parse(r.body).error.code).toBe("lab_unavailable");
      }
    } finally {
      await exposed.stop();
    }
  });
});

describe("lab: automine returns when nobody is watching", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness({ labGraceMs: 150 }); await h.indexer.syncOnce(); }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("switches a paused chain back to automine after the last client leaves", async () => {
    const app = await h.app();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.addEventListener("open", r));
    expect(h.services.lab.connectedClients).toBe(1);

    await h.post("/api/lab/mining", { mode: "manual" });
    expect((await h.services.lab.mining()).automine).toBe(false);

    ws.close();
    const deadline = Date.now() + 5000;
    while ((await h.services.lab.mining()).automine === false && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect((await h.services.lab.mining()).automine).toBe(true);
    expect(h.services.lab.connectedClients).toBe(0);
  });

  it("stays paused while another client is connected", async () => {
    const port = ((await h.app()).server.address() as { port: number }).port;
    const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([a, b].map((w) => new Promise((r) => w.addEventListener("open", r))));
    await h.post("/api/lab/mining", { mode: "manual" });

    a.close();
    await new Promise((r) => setTimeout(r, 500));
    expect((await h.services.lab.mining()).automine).toBe(false);

    b.close();
    const deadline = Date.now() + 5000;
    while ((await h.services.lab.mining()).automine === false && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect((await h.services.lab.mining()).automine).toBe(true);
  });
});
