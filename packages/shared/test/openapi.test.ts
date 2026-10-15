import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/api";
import { buildOpenApi } from "../src/openapi";

const doc = buildOpenApi() as any;

describe("OpenAPI document", () => {
  it("describes every route in the route table", () => {
    for (const r of ROUTES) expect(doc.paths[r.path]?.[r.method], `${r.method} ${r.path}`).toBeDefined();
    expect(Object.keys(doc.paths)).toHaveLength(new Set(ROUTES.map((r) => r.path)).size);
  });

  it("documents path and query parameters", () => {
    const rec = doc.paths["/api/records/{index}"].get;
    expect(rec.parameters).toEqual([{ name: "index", in: "path", required: true, schema: { type: "string" } }]);
    expect(rec.responses["404"]).toBeDefined();

    const list = doc.paths["/api/records"].get;
    const names = list.parameters.map((p: any) => p.name).sort();
    expect(names).toEqual(["actor", "limit", "offset", "productId"]);
    expect(list.parameters.find((p: any) => p.name === "limit").schema.maximum).toBe(500);
    expect(doc.paths["/api/session"].get.responses["404"]).toBeUndefined();
  });

  it("describes response bodies and shared components", () => {
    const schema = doc.paths["/api/verify"].get.responses["200"].content["application/json"].schema;
    expect(schema.properties.offChain).toBeDefined();
    expect(doc.components.schemas.Error.properties.error).toBeDefined();
    expect(doc.components.schemas.WsHello.properties.refetch).toBeDefined();
    expect(doc.openapi).toBe("3.1.0");
  });

  it("is committed and up to date (run `npm run export:openapi` if this fails)", () => {
    const committed = JSON.parse(readFileSync(new URL("../../../docs/openapi.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});
