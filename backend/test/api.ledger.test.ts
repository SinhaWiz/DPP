import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorSchema, ProductListSchema, ProductSchema, ProductTrailSchema, RecordListSchema, SessionSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createServices } from "../src/services";

describe("API: session, records and products", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.call(1, "buy", 1, { value: eth("1") });
    await h.call(1, "listForSale", 1, eth("2"));
    await h.call(2, "reserve", 1, { value: eth("2") });
    await h.call(2, "revokeReservation", 1);
    await h.call(0, "registerProduct", "Phone");
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  describe("GET /api/session", () => {
    it("describes the chain, contracts, indexer and lab, matching the schema", async () => {
      const { status, body } = await h.get("/api/session");
      expect(status).toBe(200);
      const s = SessionSchema.parse(body);
      expect(s.chainId).toBe(31337);
      expect(s.sessionId).toBe(h.deployment.sessionId);
      expect(s.contracts).toEqual({ market: h.deployment.contracts.market.address, rejecter: h.deployment.contracts.rejecter.address });
      expect(s.indexer.state).toBe("live");
      expect(s.ledgerLength).toBe(7);
      expect(s.productCount).toBe(2);
      expect(s.indexedBlock).toBe(s.headBlock);
      expect(s.roles.map((r) => r.name)).toEqual(["Manufacturer", "Distributor", "Retailer", "Customer", "Outsider", "Broken Wallet"]);
      expect(s.mining.automine).toBe(true);
      expect(s.lab).toEqual({ available: true, reason: null });
      expect(s.features.debugTrace).toBe(true);
      expect(s.seq).toBeGreaterThan(0);
    });

    it("disables the lab when the API is not bound to loopback", async () => {
      const exposed = await startHarness();
      try {
        (exposed.config as { HOST: string }).HOST = "0.0.0.0";
        const s = SessionSchema.parse((await exposed.get("/api/session")).body);
        expect(s.lab.available).toBe(false);
        expect(s.lab.reason).toContain("127.0.0.1");
      } finally {
        await exposed.stop();
      }
    });
  });

  describe("GET /api/records", () => {
    it("lists records with their verification status, in ledger order", async () => {
      const { status, body } = await h.get("/api/records");
      expect(status).toBe(200);
      const list = RecordListSchema.parse(body);
      expect(list.total).toBe(7);
      expect(list.records.map((r) => r.index)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
      expect(list.records.map((r) => r.actionLabel)).toEqual(["Registered", "Listed", "Sold", "Listed", "Reserved", "Revoked", "Registered"]);
      expect(list.records.every((r) => r.check.status === "intact" && r.check.dataOk && r.check.linkOk && r.check.anchorOk === true)).toBe(true);
      expect(list.records[0]!.productName).toBe("Laptop");
      expect(list.records[6]!.productName).toBe("Phone");
    });

    it("links each record to its transaction and carries the event witness", async () => {
      const r = RecordListSchema.parse((await h.get("/api/records")).body).records[2]!;
      expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.blockNumber).toBeGreaterThan(0);
      expect(r.witness).toMatchObject({ hash: r.hash, prevHash: r.prevHash, action: 3 });
    });

    it("pages, and filters by product and actor", async () => {
      const page = RecordListSchema.parse((await h.get("/api/records?offset=2&limit=3")).body);
      expect(page.records.map((r) => r.index)).toEqual(["2", "3", "4"]);
      expect(page.total).toBe(7);
      expect(page.offset).toBe(2);

      const phone = RecordListSchema.parse((await h.get("/api/records?productId=2")).body);
      expect(phone.total).toBe(1);
      expect(phone.records[0]!.productName).toBe("Phone");

      const customer = h.deployment.roles[2]!.address;
      const byActor = RecordListSchema.parse((await h.get(`/api/records?actor=${customer}`)).body);
      expect(byActor.records.map((r) => r.actionLabel)).toEqual(["Reserved", "Revoked"]);
    });

    it("rejects invalid query parameters with a 400", async () => {
      for (const q of ["limit=0", "limit=9999", "offset=-1", "productId=abc", "actor=nope"]) {
        const { status, body } = await h.get(`/api/records?${q}`);
        expect(status, q).toBe(400);
        expect(ErrorSchema.parse(body).error.code).toBe("bad_request");
      }
    });
  });

  describe("GET /api/products", () => {
    it("lists products with owner, price and reservation state", async () => {
      const { products } = ProductListSchema.parse((await h.get("/api/products")).body);
      expect(products.map((p) => p.name)).toEqual(["Laptop", "Phone"]);
      expect(products[0]!.owner.toLowerCase()).toBe(h.deployment.roles[1]!.address.toLowerCase());
      expect(products[0]).toMatchObject({ forSale: true, price: eth("2").toString(), reservation: null });
      expect(products[1]).toMatchObject({ forSale: false });
    });

    it("returns one product, or 404 as a typed error", async () => {
      expect(ProductSchema.parse((await h.get("/api/products/2")).body).name).toBe("Phone");
      const missing = await h.get("/api/products/99");
      expect(missing.status).toBe(404);
      expect(ErrorSchema.parse(missing.body).error.code).toBe("not_found");
      expect((await h.get("/api/products/abc")).status).toBe(400);
    });

    it("shows an active reservation on the product", async () => {
      await h.call(3, "reserve", 1, { value: eth("2") });
      await h.indexer.syncOnce();
      const p = ProductSchema.parse((await h.get("/api/products/1")).body);
      expect(p.reservation).toMatchObject({ buyer: h.deployment.roles[3]!.address, amount: eth("2").toString() });
      await h.call(3, "revokeReservation", 1);
      await h.indexer.syncOnce();
      expect(ProductSchema.parse((await h.get("/api/products/1")).body).reservation).toBeNull();
    });
  });

  describe("GET /api/products/:id/trail", () => {
    it("tells the story of a product, with the owner after each step", async () => {
      const trail = ProductTrailSchema.parse((await h.get("/api/products/1/trail")).body);
      const [manufacturer, distributor] = [h.deployment.roles[0]!.address, h.deployment.roles[1]!.address];
      expect(trail.product.name).toBe("Laptop");
      expect(trail.steps.map((s) => s.record.actionLabel)).toEqual([
        "Registered", "Listed", "Sold", "Listed", "Reserved", "Revoked", "Reserved", "Revoked",
      ]);
      expect(trail.steps[0]!.ownerAfter.toLowerCase()).toBe(manufacturer.toLowerCase());
      expect(trail.steps[1]!.ownerAfter.toLowerCase()).toBe(manufacturer.toLowerCase());
      expect(trail.steps[2]!.ownerAfter.toLowerCase()).toBe(distributor.toLowerCase());
      expect(trail.steps[5]!.ownerAfter.toLowerCase()).toBe(distributor.toLowerCase()); // a revocation changes no owner
      expect(trail.steps[0]!.note).toContain("Manufacturer");
      expect(trail.steps[2]!.note).toContain("sold it to Distributor");
      expect(trail.steps[5]!.note).toContain("refundable");
    });

    it("404s for an unknown product", async () => {
      expect((await h.get("/api/products/99/trail")).status).toBe(404);
    });
  });

  it("returns a typed 404 for an unknown route", async () => {
    const res = await h.get("/api/nope");
    expect(res.status).toBe(404);
    expect(ErrorSchema.parse(res.body).error.code).toBe("not_found");
  });
});

describe("API before there is anything to show", () => {
  it("answers with empty data and a clear indexer state when no contract is deployed", async () => {
    const config = loadConfig({}, { DB_PATH: ":memory:", LOG_LEVEL: "silent", RPC_URL: "http://127.0.0.1:1" });
    const services = createServices(config, { getDeployment: () => null });
    const app = await buildApp(services);
    try {
      await services.indexer.syncOnce();
      const session = SessionSchema.parse((await app.inject({ method: "GET", url: "/api/session" })).json());
      expect(session.indexer.state).toBe("waiting-for-node");
      expect(session.contracts).toBeNull();
      expect(session.lab.available).toBe(false);
      expect(session.mining.automine).toBeNull();
      expect(RecordListSchema.parse((await app.inject({ method: "GET", url: "/api/records" })).json()).records).toEqual([]);
      expect(ProductListSchema.parse((await app.inject({ method: "GET", url: "/api/products" })).json()).products).toEqual([]);
    } finally {
      await app.close();
      await services.stop();
    }
  });
});
