import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { LiveController } from "./live";

import { fakeApi, msg, record, session } from "@/test/fakes";

function setup(apiOver: Record<string, unknown> = {}) {
  const api = fakeApi(apiOver);
  const socket = { start: vi.fn(), stop: vi.fn(), state: "open" as const, seq: 0, ping: vi.fn() };
  const live = new LiveController({ api: api as never, createSocket: () => socket as never, debounceMs: 0 });
  return { api, socket, live };
}

describe("LiveController: loading", () => {
  it("loads everything on start and becomes live", async () => {
    const { live, api, socket } = setup();
    api.setRecordCount(3);
    live.start();
    await live.flush();
    await vi.waitFor(() => expect(live.state.loaded).toBe(true));
    expect(socket.start).toHaveBeenCalled();
    expect(live.state).toMatchObject({ link: "live", error: null, recordsTotal: 3 });
    expect(live.state.records.map((r) => r.index)).toEqual(["0", "1", "2"]);
    expect(live.state.session?.chainId).toBe(31337);
    expect(live.state.verify?.offChain.valid).toBe(true);
  });

  it("pages through long ledgers", async () => {
    const { live, api } = setup();
    api.setRecordCount(1203);
    await live.refetchAll();
    expect(live.state.records).toHaveLength(1203);
    expect(api.records.mock.calls.map((c) => c[0].offset)).toEqual([0, 500, 1000]);
  });

  it("reports an unreachable backend as offline, keeping what it already had", async () => {
    const { live, api } = setup();
    api.setRecordCount(2);
    await live.refetchAll();
    api.session.mockRejectedValueOnce(new ApiError(0, "unreachable", "Cannot reach the backend"));
    await live.refetchAll();
    expect(live.state.link).toBe("offline");
    expect(live.state.error).toContain("Cannot reach the backend");
    expect(live.state.records).toHaveLength(2); // stale data beats a blank screen
  });

  it("surfaces other failures without going offline", async () => {
    const { live, api } = setup();
    api.products.mockRejectedValueOnce(new ApiError(500, "internal", "Internal error"));
    await live.refetchAll();
    expect(live.state.link).not.toBe("offline");
    expect(live.state.error).toBe("Internal error");
  });
});

describe("LiveController: reacting to messages", () => {
  it("appends only the new records when one is appended", async () => {
    const { live, api } = setup();
    api.setRecordCount(2);
    await live.refetchAll();
    api.records.mockClear();

    api.setRecordCount(3);
    live.apply(msg("record.appended"));
    await live.flush();
    expect(api.records).toHaveBeenCalledTimes(1);
    expect(api.records.mock.calls[0]![0]).toMatchObject({ offset: 2 });
    expect(live.state.records.map((r) => r.index)).toEqual(["0", "1", "2"]);
    expect(api.products).toHaveBeenCalled();
    expect(api.verify).toHaveBeenCalled();
  });

  it("reloads every record when verification changes, because older ones may have changed", async () => {
    const { live, api } = setup();
    api.setRecordCount(3);
    await live.refetchAll();
    api.records.mockClear();
    live.apply(msg("verification.changed"));
    await live.flush();
    expect(api.records.mock.calls[0]![0]).toMatchObject({ offset: 0 });
  });

  it("reloads everything after a rewind or a reset", async () => {
    for (const type of ["chain.rewound", "chain.reset"] as const) {
      const { live, api } = setup();
      api.setRecordCount(2);
      await live.refetchAll();
      api.setRecordCount(1);
      live.apply(msg(type));
      await live.flush();
      expect(live.state.records).toHaveLength(1);
      expect(api.blocks).toHaveBeenCalledTimes(2);
      expect(api.txs).toHaveBeenCalledTimes(2);
    }
  });

  it("starts over when the ledger got shorter than the UI thought", async () => {
    const { live, api } = setup();
    api.setRecordCount(5);
    await live.refetchAll();
    api.setRecordCount(2);
    live.apply(msg("record.appended"));
    await live.flush();
    expect(live.state.records).toHaveLength(2);
  });

  it("refreshes only transactions for transaction messages", async () => {
    const { live, api } = setup();
    await live.refetchAll();
    for (const m of [api.records, api.products, api.blocks, api.verify, api.session, api.txs]) m.mockClear();
    live.apply(msg("tx.pending"));
    await live.flush();
    expect(api.txs).toHaveBeenCalledTimes(1);
    expect(api.records).not.toHaveBeenCalled();
    expect(api.blocks).not.toHaveBeenCalled();
  });

  it("batches a burst of messages into one refresh", async () => {
    const { live, api } = setup();
    await live.refetchAll();
    api.txs.mockClear();
    live.apply(msg("tx.pending", {}, 1));
    live.apply(msg("tx.mined", {}, 2));
    live.apply(msg("tx.failed", {}, 3));
    await live.flush();
    expect(api.txs).toHaveBeenCalledTimes(1);
  });

  it("bumps the epoch only when history may have changed", () => {
    const { live } = setup();
    expect(live.state.epoch).toBe(0);
    for (const t of ["block.new", "tx.mined", "record.appended", "mining.changed"] as const) live.apply(msg(t));
    expect(live.state.epoch).toBe(0);
    for (const t of ["verification.changed", "lab.tampered", "lab.restored", "chain.rewound", "chain.reset"] as const) live.apply(msg(t));
    expect(live.state.epoch).toBe(5);
  });

  it("remembers the last message for the explanation panel", () => {
    const { live } = setup();
    const m = msg("block.new", { number: 7 });
    live.apply(m);
    expect(live.state.lastMessage).toBe(m);
  });

  it("tracks scenario progress step by step and resets for the next run", () => {
    const { live } = setup();
    live.apply(msg("lab.scenario", { name: "supplyChain", step: "one", done: false }));
    live.apply(msg("lab.scenario", { name: "supplyChain", step: "two", done: false }));
    expect(live.state.scenario).toEqual({ name: "supplyChain", steps: ["one", "two"], done: false });
    live.apply(msg("lab.scenario", { name: "supplyChain", step: "done", done: true }));
    expect(live.state.scenario).toMatchObject({ steps: ["one", "two"], done: true });
    live.apply(msg("lab.scenario", { name: "bulk", step: "first", done: false }));
    expect(live.state.scenario).toEqual({ name: "bulk", steps: ["first"], done: false });
  });
});

describe("LiveController: connection", () => {
  it("reloads everything when the server could not replay history", async () => {
    let handlers: any;
    const api = fakeApi();
    const socket = { start: vi.fn(), stop: vi.fn(), state: "open" as const, seq: 0, ping: vi.fn() };
    const live = new LiveController({ api: api as never, createSocket: (h) => { handlers = h; return socket as never; }, debounceMs: 0 });
    live.start();
    await vi.waitFor(() => expect(live.state.loaded).toBe(true));
    api.session.mockClear();

    handlers.onHello({ type: "hello", seq: 3, refetch: true, replayed: 0, serverTime: 1 });
    await vi.waitFor(() => expect(api.session).toHaveBeenCalled());
  });

  it("goes offline when the socket closes and recovers on the next hello", async () => {
    let handlers: any;
    const api = fakeApi();
    const socket = { start: vi.fn(), stop: vi.fn(), state: "open" as "open" | "closed", seq: 0, ping: vi.fn() };
    const live = new LiveController({ api: api as never, createSocket: (h) => { handlers = h; return socket as never; }, debounceMs: 0 });
    live.start();
    await vi.waitFor(() => expect(live.state.link).toBe("live"));

    socket.state = "closed";
    handlers.onStatus("closed");
    expect(live.state.link).toBe("offline");

    socket.state = "open";
    handlers.onHello({ type: "hello", seq: 9, refetch: false, replayed: 4, serverTime: 1 });
    await vi.waitFor(() => expect(live.state.link).toBe("live"));
  });

  it("stop() closes the socket and ignores further start() calls while running", () => {
    const { live, socket } = setup();
    live.start();
    live.start();
    expect(socket.start).toHaveBeenCalledTimes(1);
    live.stop();
    expect(socket.stop).toHaveBeenCalled();
  });
});


describe("LiveController: read-only fallback", () => {
  const snapshot = (n = 2) => {
    const records = Array.from({ length: n }, (_, i) => ({ ...record(i), productName: "Direct" }));
    return {
      session: { ...session(), indexer: { state: "direct", message: "Reading straight from the node." }, lab: { available: false, reason: "The lab needs the backend." } },
      records, products: [{ id: "1", name: "Direct", owner: "0x" + "11".repeat(20), price: "0", forSale: false, reservation: null }],
    };
  };
  const unreachable = () => new ApiError(0, "unreachable", "Cannot reach the backend");

  function build(direct?: () => Promise<unknown>) {
    const api = fakeApi();
    api.session.mockRejectedValue(unreachable());
    const timers = { fn: null as null | (() => void), cleared: 0 };
    const live = new LiveController({
      api: api as never, createSocket: () => ({ start: vi.fn(), stop: vi.fn(), state: "closed", seq: 0, ping: vi.fn() }) as never, debounceMs: 0,
      direct: direct as never, directPollMs: 1000,
      setTimer: ((fn: () => void) => { timers.fn = fn; return 1 as never; }) as never,
      clearTimer: (() => { timers.cleared++; }) as never,
    });
    return { api, live, timers };
  }

  it("shows what the node holds when the backend cannot be reached, marked read-only", async () => {
    const { live } = build(async () => snapshot(2));
    await live.refetchAll();
    expect(live.state).toMatchObject({ direct: true, loaded: true, link: "offline", error: null, recordsTotal: 2 });
    expect(live.state.records.map((r) => r.index)).toEqual(["0", "1"]);
    expect(live.state.products[0]!.name).toBe("Direct");
    expect(live.state.session!.indexer.state).toBe("direct");
    expect(live.state.session!.lab.available).toBe(false);
    expect(live.state.txs).toEqual([]);
    expect(live.state.mining).toBeNull();
  });

  it("keeps re-reading while the backend is down", async () => {
    let n = 2;
    const { live, timers } = build(async () => snapshot(n));
    await live.refetchAll();
    expect(live.state.records).toHaveLength(2);
    n = 3;
    timers.fn!();
    await vi.waitFor(() => expect(live.state.records).toHaveLength(3));
  });

  it("returns to normal, and stops re-reading, as soon as the backend answers", async () => {
    const { live, api, timers } = build(async () => snapshot(2));
    await live.refetchAll();
    expect(live.state.direct).toBe(true);
    api.session.mockResolvedValue(session());
    api.setRecordCount(5);
    await live.refetchAll();
    expect(live.state).toMatchObject({ direct: false, error: null });   // (the fake socket stays closed, so the link itself is not asserted)
    expect(live.state.records).toHaveLength(5);
    expect(timers.cleared).toBeGreaterThanOrEqual(1);
  });

  it("is an ordinary offline state when there is nothing to read directly", async () => {
    const none = build(async () => null);
    await none.live.refetchAll();
    expect(none.live.state).toMatchObject({ direct: false, link: "offline" });
    expect(none.live.state.error).toContain("Cannot reach the backend");

    const broken = build(async () => { throw new Error("node down too"); });
    await broken.live.refetchAll();
    expect(broken.live.state).toMatchObject({ direct: false, link: "offline" });

    const noFallback = build(undefined);
    await noFallback.live.refetchAll();
    expect(noFallback.live.state).toMatchObject({ direct: false, link: "offline" });
  });

  it("only falls back for an unreachable backend, not for other errors", async () => {
    const direct = vi.fn(async () => snapshot());
    const { live, api } = build(direct);
    api.session.mockRejectedValue(new ApiError(500, "internal", "Internal error"));
    await live.refetchAll();
    expect(direct).not.toHaveBeenCalled();
    expect(live.state.error).toBe("Internal error");
  });

  it("bumps the epoch so per-record views reload", async () => {
    const { live } = build(async () => snapshot());
    const before = live.state.epoch;
    await live.refetchAll();
    expect(live.state.epoch).toBeGreaterThan(before);
  });
});
