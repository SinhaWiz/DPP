import { vi } from "vitest";
import { computeHash, GENESIS_HASH, type ApiRecord, type ApiTx, type ApiSession, type LedgerRecord, type Role, type WsMessage } from "@dpp/shared";
import { LiveController } from "@/store/live";

export const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
export const ADDR = (n: number) => "0x" + n.toString(16).padStart(40, "0");
export const ZERO_ADDR = "0x" + "00".repeat(20);

export const ROLES: Role[] = [
  { index: 0, name: "Manufacturer", description: "Creates products", address: ADDR(0xa0) },
  { index: 1, name: "Distributor", description: "Buys from the manufacturer", address: ADDR(0xa1) },
  { index: 2, name: "Retailer", description: "", address: ADDR(0xa2) },
  { index: -1, name: "Broken Wallet", description: "Refuses ETH", address: ADDR(0xff) },
];

export function record(i: number, over: Partial<ApiRecord> = {}): ApiRecord {
  return {
    index: String(i), productId: "1", productName: "Laptop", action: 0, actionLabel: "Registered", actor: ROLES[0]!.address,
    counterparty: ZERO_ADDR, price: "0", timestamp: "1700000000", prevHash: H(i), hash: H(i + 1), txHash: H(100 + i), blockNumber: i + 1,
    check: {
      dataOk: true, linkOk: true, anchorOk: true, status: "intact", onChainStatus: "intact", reasonMask: 0, reasons: [],
      recomputedHash: H(i + 1), expectedPrevHash: H(i),
    },
    witness: null,
    ...over,
  };
}

/** A ledger whose hashes are real: every record links to the previous one and matches its data. */
export function validChain(n: number): ApiRecord[] {
  const out: ApiRecord[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const r: LedgerRecord = {
      index: BigInt(i), timestamp: 1_700_000_000n + BigInt(i), productId: 1n, action: i === 0 ? 0 : 1, actor: ROLES[0]!.address,
      counterparty: ZERO_ADDR, price: i === 0 ? 0n : 10n ** 18n, prevHash: prev, hash: "",
    };
    r.hash = computeHash(r);
    prev = r.hash;
    out.push(
      record(i, {
        action: r.action, actionLabel: r.action === 0 ? "Registered" : "Listed", price: r.price.toString(), timestamp: r.timestamp.toString(),
        prevHash: r.prevHash, hash: r.hash,
        witness: { productId: "1", action: r.action, actor: r.actor, prevHash: r.prevHash, hash: r.hash },
        check: { ...record(i).check, recomputedHash: r.hash, expectedPrevHash: r.prevHash },
      }),
    );
  }
  return out;
}

export function session(over: Partial<ApiSession> = {}): ApiSession {
  return {
    chainId: 31337, sessionId: H(1), contracts: { market: ADDR(0xc0), rejecter: ADDR(0xff) }, deployBlock: 1, headBlock: 5, indexedBlock: 5,
    indexer: { state: "live", message: null }, ledgerLength: 0, productCount: 0, seq: 0, roles: ROLES, mining: { automine: true },
    lab: { available: true, reason: null }, features: { debugTrace: true }, ...over,
  };
}

export const verifyOk = {
  offChain: { valid: true, recordCount: 0, firstBrokenAt: null, firstBrokenOnChainAt: null, brokenIndexes: [] },
  onChain: null,
  comparison: null,
};

/** A backend that answers from memory. Records are generated, so tests can set how many exist. */
export function fakeApi(over: Record<string, unknown> = {}) {
  let n = 0;
  let customRecords: ApiRecord[] | null = null;
  return {
    session: vi.fn(async () => session()),
    records: vi.fn(async ({ offset = 0, limit = 500 }: { offset?: number; limit?: number }) => {
      const all = customRecords ?? validChain(n);
      return { total: all.length, offset, limit, records: all.slice(offset, offset + limit) };
    }),
    record: vi.fn(async (index: string) => {
      const r = (customRecords ?? validChain(n))[Number(index)]!;
      return { ...r, hashSteps: { fields: [], encoded: "0x", hash: r.hash }, tx: null as ApiTx | null };
    }),
    trail: vi.fn(async (id: string) => ({
      product: { id, name: "Laptop", owner: ROLES[0]!.address, price: "0", forSale: false, reservation: null },
      steps: (customRecords ?? validChain(n)).filter((r) => r.productId === id).map((record) => ({ record, ownerAfter: ROLES[0]!.address, note: `Step ${record.index}` })),
    })),
    products: vi.fn(async () => ({ products: [] })),
    txs: vi.fn(async () => ({ total: 0, txs: [] })),
    blocks: vi.fn(async () => ({ blocks: [] })),
    verify: vi.fn(async () => verifyOk),
    balances: vi.fn(async () => ({
      balances: ROLES.map((r) => ({ address: r.address, name: r.name, withdrawable: "0", balance: (100n * 10n ** 18n).toString() })),
      contractBalance: "0",
    })),
    lab: {
      status: vi.fn(async (): Promise<{ mining: { mode: "auto" | "manual" | "interval"; automine: boolean; intervalMs: number | null }; clients: number }> => ({
        mining: { mode: "auto", automine: true, intervalMs: null }, clients: 1,
      })),
      setMining: vi.fn(async (mode: "auto" | "manual" | "interval", intervalMs?: number) => ({ mode, automine: mode === "auto", intervalMs: mode === "interval" ? (intervalMs ?? 3000) : null })),
      mine: vi.fn(async (blocks = 1) => ({ mined: blocks, headBlock: 10 })),
      increaseTime: vi.fn(async (seconds: number) => ({ timestamp: 1_800_000_000 + seconds })),
      runScenario: vi.fn(async (name: string) => ({ name, steps: [] as string[], result: {} as Record<string, unknown> })),
      dropTx: vi.fn(async (hash: string) => ({ hash, dropped: true as const })),
      replaceTx: vi.fn(async (hash: string, mode: "cancel" | "speedUp") => ({ original: hash, replacement: "0x" + "ee".repeat(32), mode })),
    },
    setRecordCount: (c: number) => { n = c; customRecords = null; },
    setRecords: (r: ApiRecord[]) => { customRecords = r; },
    ...over,
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;

export function fakeSocket() {
  const s = { start: vi.fn(), stop: vi.fn(), state: "open" as "open" | "closed" | "connecting", seq: 0, ping: vi.fn() };
  let handlers: any = null;
  return { socket: s, handlers: () => handlers, create: (h: unknown) => { handlers = h; return s as never; } };
}

/** A running controller backed by fakes, already loaded. */
export async function startFakeController(apiOver: Record<string, unknown> = {}) {
  const api = fakeApi(apiOver);
  const fs = fakeSocket();
  const controller = new LiveController({ api: api as never, createSocket: fs.create as never, debounceMs: 0 });
  return { api, controller, ...fs };
}

export const msg = (type: WsMessage["type"], data: unknown = {}, seq = 1): WsMessage => ({ seq, type, at: 1, data });
