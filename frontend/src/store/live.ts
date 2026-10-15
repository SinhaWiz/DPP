import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ApiBalances, ApiBlock, ApiMiningState, ApiProduct, ApiRecord, ApiRecordDetail, ApiSession, ApiTx, ApiVerify, WsHello, WsMessage } from "@dpp/shared";
import { ApiError, type Api } from "@/api/client";
import { LiveSocket, defaultSocketUrl, type SocketStatus } from "@/api/socket";

export type Link = "connecting" | "live" | "offline";

export interface ScenarioProgress {
  name: string;
  steps: string[];
  done: boolean;
}

export interface LiveState {
  /** Backend reachability as the UI experiences it. */
  link: Link;
  /** Last problem worth telling the user about. */
  error: string | null;
  loaded: boolean;
  session: ApiSession | null;
  records: ApiRecord[];
  recordsTotal: number;
  products: ApiProduct[];
  txs: ApiTx[];
  txsTotal: number;
  blocks: ApiBlock[];
  verify: ApiVerify | null;
  /** Who has money waiting to be withdrawn (pull payments), and what the contract holds. */
  balances: ApiBalances | null;
  /** How the chain is being mined; null when the lab is not available. */
  mining: ApiMiningState | null;
  scenario: ScenarioProgress | null;
  /** The last bus message applied, for "what just happened" panels. */
  lastMessage: WsMessage | null;
}

const INITIAL: LiveState = {
  link: "connecting", error: null, loaded: false, session: null, records: [], recordsTotal: 0, products: [], txs: [], txsTotal: 0,
  blocks: [], verify: null, balances: null, mining: null, scenario: null, lastMessage: null,
};

type Kind = "session" | "records" | "recordsFull" | "products" | "txs" | "blocks" | "verify" | "mining" | "balances";

const PAGE = 500;

export interface LiveDeps {
  api: Api;
  /** Builds the socket; replaced in tests. */
  createSocket?: (handlers: ConstructorParameters<typeof LiveSocket>[0]["handlers"]) => LiveSocket;
  /** Waits before refetching so a burst of messages causes one refresh. */
  debounceMs?: number;
}

/**
 * Keeps the UI's copy of the chain current. It loads everything over REST, then listens to the
 * WebSocket and, for each kind of message, refetches only what that message made stale. The server
 * stays the single source of truth; the browser never tries to replay events itself.
 */
export class LiveController {
  readonly store: StoreApi<LiveState> = createStore<LiveState>(() => ({ ...INITIAL }));
  private socket: LiveSocket | null = null;
  private dirty = new Set<Kind>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private running = false;
  private details = new Map<string, Promise<ApiRecordDetail>>();

  constructor(private readonly d: LiveDeps) {}

  /** The API client, for components that need something the store does not hold. */
  get api(): Api {
    return this.d.api;
  }

  /**
   * One record in full (creating transaction, hash breakdown). Cached, because hovering the same
   * block repeatedly should not hit the server; the cache is dropped whenever history can change.
   */
  recordDetail(index: string): Promise<ApiRecordDetail> {
    let p = this.details.get(index);
    if (!p) {
      p = this.d.api.record(index);
      p.catch(() => this.details.delete(index)); // do not cache failures
      this.details.set(index, p);
    }
    return p;
  }

  get state(): LiveState {
    return this.store.getState();
  }

  private set(patch: Partial<LiveState>) {
    this.store.setState(patch);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.socket =
      this.d.createSocket?.({
        onMessage: (m) => this.apply(m),
        onHello: (h) => void this.onHello(h),
        onStatus: (s) => this.onSocketStatus(s),
      }) ??
      new LiveSocket({
        url: defaultSocketUrl(),
        handlers: { onMessage: (m) => this.apply(m), onHello: (h) => void this.onHello(h), onStatus: (s) => this.onSocketStatus(s) },
      });
    this.socket.start();
    void this.refetchAll();
  }

  stop(): void {
    this.running = false;
    this.socket?.stop();
    this.socket = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private onSocketStatus(s: SocketStatus) {
    if (s === "open") return; // `live` is set once data arrives (onHello)
    if (s === "closed") this.set({ link: "offline" });
    else if (this.state.link !== "live") this.set({ link: "connecting" });
  }

  private async onHello(hello: WsHello) {
    // After a reconnect the server replays what we missed, unless it cannot; then reload everything.
    if (hello.refetch || this.state.link !== "live") await this.refetchAll();
    else this.set({ link: "live" });
  }

  // ───────────────────────── loading ─────────────────────────

  /** Reloads every collection. Used at start-up, after a reset or rewind, and when history was lost. */
  async refetchAll(): Promise<void> {
    await this.load(["session", "recordsFull", "products", "txs", "blocks", "verify", "balances"]);
  }

  private async load(kinds: Kind[]): Promise<void> {
    const { api } = this.d;
    try {
      const wants = new Set(kinds);
      const tasks: Promise<void>[] = [];
      if (wants.has("session")) tasks.push(api.session().then((session) => this.set({ session })));
      if (wants.has("recordsFull")) tasks.push(this.loadRecords(true));
      else if (wants.has("records")) tasks.push(this.loadRecords(false));
      if (wants.has("products")) tasks.push(api.products().then((r) => this.set({ products: r.products })));
      if (wants.has("txs")) tasks.push(api.txs({ limit: 200 }).then((r) => this.set({ txs: r.txs, txsTotal: r.total })));
      if (wants.has("blocks")) tasks.push(api.blocks().then((r) => this.set({ blocks: r.blocks })));
      if (wants.has("verify")) tasks.push(api.verify().then((verify) => this.set({ verify })));
      if (wants.has("balances")) tasks.push(api.balances().then((balances) => this.set({ balances })));
      await Promise.all(tasks);
      if (wants.has("session") || wants.has("mining")) await this.loadMining();
      this.set({ link: this.socket?.state === "closed" ? "offline" : "live", error: null, loaded: true });
    } catch (e) {
      if (e instanceof ApiError && e.unreachable) this.set({ link: "offline", error: e.message });
      else this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Mining mode comes from the lab, which only exists on the local chain. */
  private async loadMining(): Promise<void> {
    if (!this.state.session?.lab.available) return this.set({ mining: null });
    try {
      this.set({ mining: (await this.d.api.lab.status()).mining });
    } catch {
      this.set({ mining: null });
    }
  }

  private async loadRecords(full: boolean): Promise<void> {
    const { api } = this.d;
    const have = full ? 0 : this.state.records.length;
    let collected: ApiRecord[] = [];
    let total = 0;
    for (let offset = have; ; offset += PAGE) {
      const page = await api.records({ offset, limit: PAGE });
      total = page.total;
      collected = collected.concat(page.records);
      if (offset + PAGE >= page.total || page.records.length === 0) break;
    }
    if (!full && have > total) return this.loadRecords(true); // the ledger got shorter: start over
    this.set({ records: full ? collected : [...this.state.records, ...collected], recordsTotal: total });
  }

  // ───────────────────────── messages ─────────────────────────

  private mark(...kinds: Kind[]) {
    kinds.forEach((k) => this.dirty.add(k));
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.d.debounceMs ?? 80);
  }

  /** Runs the pending refetches. Exposed so tests (and the lab) can wait for the UI to be current. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flushing;
    if (this.dirty.size === 0) return;
    const kinds = [...this.dirty];
    this.dirty.clear();
    this.flushing = this.load(kinds).finally(() => { this.flushing = null; });
    await this.flushing;
  }

  apply(m: WsMessage): void {
    this.set({ lastMessage: m });
    if (["verification.changed", "lab.tampered", "lab.restored", "chain.rewound", "chain.reset"].includes(m.type)) this.details.clear();
    switch (m.type) {
      case "block.new":
        return this.mark("blocks", "session");
      case "tx.mined":
      case "tx.failed":
        return this.mark("txs", "balances");
      case "tx.pending":
      case "tx.replaced":
      case "tx.dropped":
        return this.mark("txs");
      case "record.appended":
        return this.mark("records", "products", "session", "verify", "balances");
      case "verification.changed":
      case "lab.tampered":
      case "lab.restored":
        return this.mark("recordsFull", "verify", "products", "balances");
      case "chain.rewound":
      case "chain.reset":
        return this.mark("session", "recordsFull", "products", "txs", "blocks", "verify", "balances");
      case "mining.changed":
        this.set({ mining: m.data as ApiMiningState });
        return this.mark("session");
      case "indexer.status":
        return this.mark("session");
      case "lab.scenario": {
        const d = m.data as { name?: string; step?: string; done?: boolean };
        const prev = this.state.scenario;
        const steps = prev && prev.name === d.name && !prev.done ? prev.steps : [];
        this.set({
          scenario: { name: d.name ?? "scenario", steps: d.done ? steps : [...steps, d.step ?? ""], done: !!d.done },
        });
        return;
      }
    }
  }
}

// ───────────────────────── the app's instance ─────────────────────────

let instance: LiveController | null = null;

export function setLiveController(c: LiveController | null): void {
  instance?.stop();
  instance = c;
}

export function getLiveController(): LiveController {
  if (!instance) throw new Error("The live data layer was not started");
  return instance;
}

/**
 * Selects part of the live state in a component. Selections are compared shallowly, so a selector may
 * return a fresh object (`s => ({ a: s.a, b: s.b })`) without causing endless re-renders.
 *
 * Careful: the *values* inside that object are compared by reference. Select stable pieces of state
 * (`s.txs`) and derive anything new (`filter`, `map`) in the component with `useMemo`; a selector that
 * builds a new array or object for one of those values will re-render forever.
 */
export function useLive<T>(selector: (s: LiveState) => T): T {
  return useStore(getLiveController().store, useShallow(selector));
}
