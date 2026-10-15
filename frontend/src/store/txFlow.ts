import { createStore, type StoreApi } from "zustand/vanilla";
import { explainError, marketInterface, type ApiTxDetail, type WsMessage } from "@dpp/shared";
import type { Api } from "@/api/client";
import type { ActionDef, Built } from "@/web3/actions";
import type { MarketClient } from "@/web3/market";
import { FINAL_STAGES, type FlowStage, type FlowTx } from "./flowTypes";

export interface FlowState {
  items: FlowTx[];
  /** The transaction shown in the pipeline view. */
  activeId: string | null;
}

export interface FlowDeps {
  api: Api;
  /** The market client for whoever is acting right now. */
  market: () => MarketClient | null;
  who: () => { address: string; role: string | null } | null;
  now?: () => number;
  /** How often to ask the backend about unfinished transactions in case a message was missed. */
  pollMs?: number;
  /** Replaced in tests. */
  setTimer?: typeof setInterval;
  clearTimer?: typeof clearInterval;
}

const MAX_ITEMS = 100;
const sameHash = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function fromBackend(state: ApiTxDetail["state"]): FlowStage | null {
  switch (state) {
    case "pending": return "pending";
    case "mined": return "mined";
    case "failed": return "failed";
    case "replaced": return "replaced";
    case "dropped": return "dropped";
  }
}

/**
 * Takes a transaction from "I want to do this" to "it is on the chain", step by step: prepare the call,
 * simulate it, sign and send it, then follow it as the node mines (or drops, or replaces) it.
 * The first three steps happen here in the browser; the rest are reported by the backend.
 */
export class TxFlow {
  readonly store: StoreApi<FlowState> = createStore<FlowState>(() => ({ items: [], activeId: null }));
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: FlowDeps) {}

  get state(): FlowState {
    return this.store.getState();
  }

  get(id: string): FlowTx | undefined {
    return this.state.items.find((t) => t.id === id);
  }

  private now() {
    return (this.d.now ?? Date.now)();
  }

  private update(id: string, patch: Partial<FlowTx>) {
    this.store.setState((s) => ({
      items: s.items.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (patch.stage && patch.stage !== t.stage) next.history = [...t.history, { stage: patch.stage, at: this.now() }];
        return next;
      }),
    }));
  }

  // ───────────────────────── preparing ─────────────────────────

  /** Encodes the call and starts tracking it as a draft. Nothing is simulated or sent yet. */
  draft(def: ActionDef, built: Built): FlowTx {
    const who = this.d.who();
    if (!who) throw new Error("Choose who you act as before preparing a transaction.");

    const fragment = marketInterface.getFunction(def.fn)!;
    const shown: Record<string, string> = {};
    fragment.inputs.forEach((input, i) => { shown[input.name || `arg${i}`] = String(built.args[i]); });

    const tx: FlowTx = {
      id: `tx-${++this.seq}`, fn: def.fn, label: def.label, args: built.args, shownArgs: shown, value: built.value, writesRecord: def.writesRecord,
      from: who.address, fromRole: who.role,
      calldata: marketInterface.encodeFunctionData(fragment, built.args), selector: fragment.selector, signature: fragment.format("sighash"),
      stage: "draft", simulation: null, forced: false, hash: null, nonce: null, backend: null, error: null,
      history: [{ stage: "draft", at: this.now() }],
    };
    this.store.setState((s) => ({ items: [tx, ...s.items].slice(0, MAX_ITEMS), activeId: tx.id }));
    return tx;
  }

  setActive(id: string | null) {
    this.store.setState({ activeId: id });
  }

  remove(id: string) {
    this.store.setState((s) => ({ items: s.items.filter((t) => t.id !== id), activeId: s.activeId === id ? null : s.activeId }));
  }

  // ───────────────────────── running ─────────────────────────

  /** Asks the node whether the call would succeed, without sending it. */
  async simulate(id: string): Promise<boolean> {
    const tx = this.get(id);
    const market = this.d.market();
    if (!tx || !market) return false;
    this.update(id, { stage: "simulating" });
    try {
      const sim = await market.simulate(tx.fn, tx.args, { value: tx.value });
      this.update(id, sim.ok ? { stage: "simulated", simulation: sim } : { stage: "simfail", simulation: sim, error: sim.error });
      return sim.ok;
    } catch (e) {
      this.update(id, { stage: "error", error: explainError(e) });
      return false;
    }
  }

  /**
   * Signs and sends. `force` sends with a fixed gas limit even if the simulation said it would fail,
   * so the failure can be watched on the chain.
   */
  async submit(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const tx = this.get(id);
    const market = this.d.market();
    if (!tx || !market) return;
    this.update(id, { stage: "signing", forced: !!opts.force, error: null });
    try {
      const sent = await market.send(tx.fn, tx.args, { value: tx.value, force: opts.force });
      this.update(id, { stage: "pending", hash: sent.hash, nonce: sent.nonce });
      this.ensurePolling();
      void this.refresh(id);
    } catch (e) {
      const why = explainError(e);
      this.update(id, { stage: why.name === "ACTION_REJECTED" ? "rejected" : "error", error: why });
    }
  }

  /** Simulate, and send only if it would succeed. */
  async run(id: string): Promise<void> {
    if (await this.simulate(id)) await this.submit(id);
  }

  sendAnyway(id: string): Promise<void> {
    return this.submit(id, { force: true });
  }

  // ───────────────────────── following ─────────────────────────

  /** Reloads one transaction from the backend and moves the flow to the stage it reports. */
  async refresh(id: string): Promise<void> {
    const tx = this.get(id);
    if (!tx?.hash) return;
    try {
      const backend = await this.d.api.tx(tx.hash);
      const stage = fromBackend(backend.state);
      const patch: Partial<FlowTx> = { backend, nonce: backend.nonce };
      // never walk backwards out of a final state
      if (stage && !FINAL_STAGES.includes(tx.stage)) patch.stage = stage;
      else if (stage && tx.stage === "mined" && stage !== "mined") patch.stage = stage; // e.g. rewound
      this.update(id, patch);
    } catch {
      // not known to the backend yet; the next message or poll tries again
    }
  }

  onMessage(m: WsMessage): void {
    const data = (m.data ?? {}) as { hash?: string; txHash?: string; replacedBy?: string };
    const hit = (h: string | null) => this.state.items.filter((t) => sameHash(t.hash, h)).map((t) => t.id);

    if (m.type.startsWith("tx.")) {
      for (const id of [...hit(data.hash ?? null), ...hit(data.replacedBy ?? null)]) void this.refresh(id);
    } else if (m.type === "record.appended") {
      for (const id of hit(data.txHash ?? null)) void this.refresh(id);
    } else if (m.type === "verification.changed" || m.type === "chain.rewound" || m.type === "chain.reset") {
      for (const t of this.state.items) if (t.hash && (t.stage === "mined" || t.stage === "pending")) void this.refresh(t.id);
    }
  }

  // ───────────────────────── fallback polling ─────────────────────────

  private unfinished(): FlowTx[] {
    return this.state.items.filter((t) => t.hash && (t.stage === "pending" || (t.stage === "mined" && t.writesRecord && !t.backend?.stages.some((s) => s.key === "verified"))));
  }

  private ensurePolling() {
    if (this.timer || !this.d.pollMs) return;
    this.timer = (this.d.setTimer ?? setInterval)(() => {
      const open = this.unfinished();
      if (open.length === 0) return this.stopPolling();
      open.forEach((t) => void this.refresh(t.id));
    }, this.d.pollMs);
  }

  private stopPolling() {
    if (this.timer) (this.d.clearTimer ?? clearInterval)(this.timer);
    this.timer = null;
  }

  dispose() {
    this.stopPolling();
  }
}
