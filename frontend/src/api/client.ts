import { z } from "zod";
import {
  BalanceListSchema, BlockListSchema, DropResultSchema, ErrorSchema, LabStatusSchema, MineResultSchema, MiningStateSchema, ProductListSchema, ProductSchema,
  ProductTrailSchema, RecordDetailSchema, RecordListSchema, ReplaceResultSchema, RestoreResultSchema, ResetResultSchema,
  ScenarioListSchema, ScenarioRunSchema, SessionSchema, SnapshotListSchema, SnapshotSchema, StorageRecordSchema, TamperListSchema,
  TamperResultSchema, TimeResultSchema, TxDetailSchema, TxListSchema, UndoAllSchema, VerifyRangeSchema, VerifySchema,
} from "@dpp/shared";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
  /** True when the backend could not be reached at all (as opposed to answering with an error). */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

export type Fetch = typeof fetch;

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Typed access to the backend. Every response is validated against the shared zod schema, so if the
 * server and the UI drift apart the error says so instead of rendering garbage.
 */
export function createApi(baseUrl = "", fetchImpl: Fetch = (...a) => fetch(...a)) {
  async function request<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(0, "unreachable", `Cannot reach the backend (${e instanceof Error ? e.message : e}). Start it with \`npm run dev:backend\`.`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(res.status, "bad_response", `The backend answered ${res.status} with something that is not JSON`);
    }

    if (!res.ok) {
      const e = ErrorSchema.safeParse(json);
      if (e.success) throw new ApiError(res.status, e.data.error.code, e.data.error.message);
      throw new ApiError(res.status, "http_error", `The backend answered ${res.status}`);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(res.status, "contract_mismatch", `${method} ${path} returned data the UI does not understand: ${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
    }
    return parsed.data;
  }

  const get = <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema);
  const post = <S extends z.ZodType>(path: string, schema: S, body?: unknown) => request("POST", path, schema, body ?? {});

  return {
    session: () => get("/api/session", SessionSchema),
    records: (q: { offset?: number; limit?: number; productId?: string; actor?: string } = {}) => get(`/api/records${qs(q)}`, RecordListSchema),
    record: (index: string | number) => get(`/api/records/${index}`, RecordDetailSchema),
    products: () => get("/api/products", ProductListSchema),
    product: (id: string | number) => get(`/api/products/${id}`, ProductSchema),
    trail: (id: string | number) => get(`/api/products/${id}/trail`, ProductTrailSchema),
    txs: (q: { offset?: number; limit?: number; state?: string; from?: string } = {}) => get(`/api/txs${qs(q)}`, TxListSchema),
    tx: (hash: string) => get(`/api/txs/${hash}`, TxDetailSchema),
    blocks: (q: { from?: number; to?: number } = {}) => get(`/api/blocks${qs(q)}`, BlockListSchema),
    verify: () => get("/api/verify", VerifySchema),
    balances: () => get("/api/balances", BalanceListSchema),
    verifyRange: (from: number, to: number) => get(`/api/verify/range${qs({ from, to })}`, VerifyRangeSchema),
    storageRecord: (index: string | number) => get(`/api/storage/records/${index}`, StorageRecordSchema),

    lab: {
      status: () => get("/api/lab/status", LabStatusSchema),
      setMining: (mode: "auto" | "manual" | "interval", intervalMs?: number) => post("/api/lab/mining", MiningStateSchema, { mode, intervalMs }),
      mine: (blocks = 1) => post("/api/lab/mine", MineResultSchema, { blocks }),
      increaseTime: (seconds: number) => post("/api/lab/time", TimeResultSchema, { seconds }),
      dropTx: (hash: string) => post(`/api/lab/txs/${hash}/drop`, DropResultSchema),
      replaceTx: (hash: string, mode: "cancel" | "speedUp") => post(`/api/lab/txs/${hash}/replace`, ReplaceResultSchema, { mode }),
      snapshots: () => get("/api/lab/snapshots", SnapshotListSchema),
      snapshot: (name: string) => post("/api/lab/snapshots", SnapshotSchema, { name }),
      restore: (name: string) => post("/api/lab/restore", RestoreResultSchema, { name }),
      attacks: () => get("/api/lab/tamper", TamperListSchema),
      tamper: (b: { index: string | number; field: string; value: string | number; mode?: "data" | "data+hash" | "rewrite-tail" }) =>
        post("/api/lab/tamper", TamperResultSchema, b),
      undo: (groupId: string) => post(`/api/lab/tamper/${groupId}/undo`, TamperResultSchema),
      undoAll: () => post("/api/lab/tamper/undo-all", UndoAllSchema),
      scenarios: () => get("/api/lab/scenarios", ScenarioListSchema),
      runScenario: (name: string, options: { count?: number } = {}) => post(`/api/lab/scenarios/${name}`, ScenarioRunSchema, options),
      reset: (o: { seed?: boolean; withFailures?: boolean } = {}) => post("/api/lab/reset", ResetResultSchema, o),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
