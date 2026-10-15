import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { Bus } from "../src/bus";
import { loadConfig } from "../src/config";
import { createRpc } from "../src/chain/rpc";
import { createServices } from "../src/services";
import { DatabaseSync } from "../src/sqlite";
import { startDevNode, type DevNode } from "@dpp/shared/testing";

describe("config", () => {
  it("has safe defaults", () => {
    const c = loadConfig({});
    expect(c.HOST).toBe("127.0.0.1");
    expect(c.PORT).toBe(4000);
    expect(c.TRACE_STORAGE).toBe(true);
    expect(c.CORS_ORIGINS).toContain("http://localhost:5173");
  });

  it("parses overrides and rejects bad values", () => {
    expect(loadConfig({ PORT: "5000", TRACE_STORAGE: "0", CORS_ORIGINS: "http://a, http://b" })).toMatchObject({
      PORT: 5000, TRACE_STORAGE: false, CORS_ORIGINS: ["http://a", "http://b"],
    });
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ RPC_URL: "not a url" })).toThrow(/RPC_URL/);
  });
});

describe("bus", () => {
  it("numbers messages, notifies subscribers and replays after a given seq", () => {
    const bus = new Bus(3);
    const seen: number[] = [];
    const off = bus.subscribe((m) => seen.push(m.seq));
    bus.publish("block.new", { n: 1 });
    bus.publish("block.new", { n: 2 });
    off();
    bus.publish("block.new", { n: 3 });
    expect(seen).toEqual([1, 2]);
    expect(bus.since(1)!.map((m) => m.seq)).toEqual([2, 3]);
    expect(bus.since(3)).toEqual([]);
  });

  it("says 'refetch' when the buffer no longer reaches back", () => {
    const bus = new Bus(2);
    for (let i = 0; i < 5; i++) bus.publish("block.new", i);
    expect(bus.since(1)).toBeNull();
    expect(bus.since(3)!.map((m) => m.seq)).toEqual([4, 5]);
  });

  it("survives a throwing subscriber", () => {
    const bus = new Bus();
    bus.subscribe(() => { throw new Error("boom"); });
    expect(() => bus.publish("block.new", 1)).not.toThrow();
  });
});

describe("http app", () => {
  it("answers /health and sets CORS for the Vite origin", async () => {
    const config = loadConfig({}, { LOG_LEVEL: "silent", DB_PATH: ":memory:" });
    const services = createServices(config, { getDeployment: () => null });
    const app = await buildApp(services);
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:5173" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, seq: 0 });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    await app.close();
    await services.stop();
  });
});

describe("sqlite", () => {
  it("is available", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t (a integer)");
    db.prepare("insert into t values (?)").run(7);
    expect(db.prepare("select a from t").get()).toEqual({ a: 7 });
    db.close();
  });
});

describe("rpc client", () => {
  let node: DevNode;
  beforeAll(async () => { node = await startDevNode(); }, 60_000);
  afterAll(async () => { await node.stop(); });

  it("talks to a real node and reports liveness", async () => {
    const rpc = createRpc(node.url);
    expect(await rpc.ping()).toBe(true);
    expect(await rpc.send("eth_chainId")).toBe("0x7a69");
    rpc.destroy();
  });

  it("reports a dead node without throwing from ping, and retries then fails from send", async () => {
    const rpc = createRpc("http://127.0.0.1:1", { retries: 1, baseDelayMs: 5 });
    expect(await rpc.ping()).toBe(false);
    await expect(rpc.send("eth_chainId")).rejects.toThrow();
    rpc.destroy();
  });

  it("does not retry JSON-RPC errors", async () => {
    const rpc = createRpc(node.url, { retries: 3, baseDelayMs: 1000 });
    const t = Date.now();
    await expect(rpc.send("no_such_method")).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(900);
    rpc.destroy();
  });
});
