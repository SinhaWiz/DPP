import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorSchema, VerifyRangeSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";

describe("GET /api/verify/range", () => {
  let h: Harness;
  const range = async (from: number, to: number) => {
    const r = await h.get(`/api/verify/range?from=${from}&to=${to}`);
    return { status: r.status, body: r.status === 200 ? VerifyRangeSchema.parse(r.body) : r.body };
  };
  const tamper = (index: number, mode: string) => h.post("/api/lab/tamper", { index, field: "price", value: "999", mode });

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    for (let i = 1n; i <= 5n; i++) await h.call(0, "listForSale", 1, eth("1") * i); // 6 records
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("agrees an intact range is valid, whatever its bounds", async () => {
    for (const [a, b] of [[0, 6], [2, 4], [3, 3], [0, 0]] as [number, number][]) {
      const { body } = await range(a, b);
      expect(body).toMatchObject({ from: a, to: b, contract: { valid: true }, offChain: { valid: true, brokenIndexes: [] } });
    }
  });

  it("only sees tampering inside the range it is asked about", async () => {
    await tamper(4, "data");
    const before = (await range(0, 4)).body as ReturnType<typeof VerifyRangeSchema.parse>;
    expect(before.contract.valid).toBe(true);
    expect(before.offChain.valid).toBe(true);

    const inside = (await range(2, 6)).body as ReturnType<typeof VerifyRangeSchema.parse>;
    expect(inside.contract).toMatchObject({ valid: false, brokenAt: "4", audit: { brokenIndexes: ["4"], reasons: [1] } });
    expect(inside.offChain).toMatchObject({ valid: false, brokenIndexes: ["4"], contractVisibleIndexes: ["4"] });
    await h.post("/api/lab/tamper/undo-all");
  });

  it("shows what the contract can see versus what the event log adds (level 2)", async () => {
    await tamper(2, "data+hash");
    const { body } = (await range(0, 6)) as { body: ReturnType<typeof VerifyRangeSchema.parse> };
    // the contract sees the NEXT link break; the log also exposes the forged record itself
    expect(body.contract).toMatchObject({ valid: false, brokenAt: "3" });
    expect(body.offChain.contractVisibleIndexes).toEqual(["3"]);
    expect(body.offChain.brokenIndexes).toEqual(["2", "3"]);
    await h.post("/api/lab/tamper/undo-all");
  });

  it("a full rewrite fools the contract's range check but not the log (level 3)", async () => {
    await tamper(1, "rewrite-tail");
    const { body } = (await range(0, 6)) as { body: ReturnType<typeof VerifyRangeSchema.parse> };
    expect(body.contract.valid).toBe(true);
    expect(body.offChain.valid).toBe(false);
    expect(body.offChain.contractVisibleIndexes).toEqual([]);
    expect(body.offChain.brokenIndexes).toHaveLength(5);
    await h.post("/api/lab/tamper/undo-all");
  });

  it("rejects ranges the contract would refuse, with a message that says why", async () => {
    for (const [a, b] of [[3, 2], [0, 7], [8, 9]] as [number, number][]) {
      const { status, body } = await range(a, b);
      expect(status, `${a}-${b}`).toBe(400);
      expect(ErrorSchema.parse(body).error.message).toContain("from ≤ to ≤ 6");
    }
    expect((await h.get("/api/verify/range?from=x&to=2")).status).toBe(400);
    expect((await h.get("/api/verify/range")).status).toBe(400);
  });
});
