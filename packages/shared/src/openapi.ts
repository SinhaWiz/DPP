import { z } from "zod";
import { ErrorSchema, ROUTES, WsHelloSchema, WsMessageSchema } from "./api";

type Json = Record<string, unknown>;

function schemaOf(s: z.ZodType, io: "input" | "output"): Json {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, { io, target: "draft-2020-12" }) as Json;
  return rest;
}

/** OpenAPI 3.1 description of the HTTP API, generated from the zod schemas in `api.ts`. */
export function buildOpenApi(): Json {
  const paths: Record<string, Json> = {};

  for (const route of ROUTES) {
    const parameters: Json[] = [];

    for (const name of [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)) {
      parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
    if (route.query) {
      const json = schemaOf(route.query, "input") as { properties?: Record<string, Json>; required?: string[] };
      for (const [name, schema] of Object.entries(json.properties ?? {})) {
        parameters.push({ name, in: "query", required: json.required?.includes(name) ?? false, schema });
      }
    }

    const hasPathParam = route.path.includes("{");
    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      [route.method]: {
        tags: [route.tag],
        summary: route.summary,
        parameters,
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: schemaOf(route.response, "output") } } },
          "400": { description: "Invalid parameters", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          ...(hasPathParam
            ? { "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } }
            : {}),
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Buy/Sell Ledger Visualizer API",
      version: "1.0.0",
      description:
        "Read API over the indexed chain. Amounts, indexes and other values that can exceed 2^53 are decimal strings. " +
        "Live updates are pushed over the WebSocket at /ws (see components.schemas.WsHello / WsMessage).",
    },
    servers: [{ url: "http://127.0.0.1:4000" }],
    tags: [{ name: "chain" }, { name: "ledger" }, { name: "transactions" }, { name: "lab" }],
    paths,
    components: {
      schemas: {
        Error: schemaOf(ErrorSchema, "output"),
        WsHello: schemaOf(WsHelloSchema, "output"),
        WsMessage: schemaOf(WsMessageSchema, "output"),
      },
    },
  };
}
