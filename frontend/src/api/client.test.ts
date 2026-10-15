import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("builds query strings, skipping empty values", async () => {
    const f = vi.fn().mockResolvedValue(json({ total: 0, offset: 0, limit: 5, records: [] }));
    await createApi("http://x", f).records({ offset: 10, limit: 5, productId: undefined, actor: "" });
    expect(f.mock.calls[0]![0]).toBe("http://x/api/records?offset=10&limit=5");
  });

  it("returns validated data", async () => {
    const f = vi.fn().mockResolvedValue(json({ products: [] }));
    expect(await createApi("", f).products()).toEqual({ products: [] });
  });

  it("turns the server's typed error into an ApiError", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: { code: "not_found", message: "Product #9 not found" } }, 404));
    const err = await createApi("", f).product(9).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "Product #9 not found", unreachable: false });
  });

  it("reports an unreachable backend with advice", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const err = await createApi("", f).session().catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "unreachable", unreachable: true });
    expect(err.message).toContain("dev:backend");
  });

  it("catches data that does not match the contract", async () => {
    const f = vi.fn().mockResolvedValue(json({ products: [{ id: "oops" }] }));
    const err = await createApi("", f).products().catch((e) => e);
    expect(err).toMatchObject({ code: "contract_mismatch" });
    expect(err.message).toContain("products");
  });

  it("handles non-JSON and untyped error bodies", async () => {
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    expect(await createApi("", html).session().catch((e) => e)).toMatchObject({ status: 502, code: "bad_response" });
    const odd = vi.fn().mockResolvedValue(json({ message: "boom" }, 500));
    expect(await createApi("", odd).session().catch((e) => e)).toMatchObject({ status: 500, code: "http_error" });
  });

  it("posts JSON bodies for lab actions", async () => {
    const f = vi.fn().mockResolvedValue(json({ mode: "manual", automine: false, intervalMs: null }));
    const r = await createApi("", f).lab.setMining("manual");
    expect(r.mode).toBe("manual");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/lab/mining");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ mode: "manual" });
  });

  it("sends an empty JSON object for actions without a body", async () => {
    const f = vi.fn().mockResolvedValue(json({ undone: [], offChain: { valid: true, recordCount: 0, firstBrokenAt: null, firstBrokenOnChainAt: null, brokenIndexes: [] } }));
    await createApi("", f).lab.undoAll();
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({});
  });
});
