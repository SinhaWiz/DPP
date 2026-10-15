import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WsHelloSchema, WsMessageSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";

interface Client {
  messages: any[];
  closed: Promise<number>;
  waitFor: (n: number, ms?: number) => Promise<void>;
  send: (v: unknown) => void;
  close: () => void;
}

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: any[] = [];
    const waiters: (() => void)[] = [];
    const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
    ws.addEventListener("message", (e) => {
      messages.push(JSON.parse(String(e.data)));
      waiters.forEach((w) => w());
    });
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("open", () =>
      resolve({
        messages, closed,
        send: (v) => ws.send(JSON.stringify(v)),
        close: () => ws.close(),
        waitFor: (n, ms = 5000) =>
          new Promise<void>((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timed out waiting for ${n} messages, have ${messages.length}`)), ms);
            const check = () => { if (messages.length >= n) { clearTimeout(t); res(); } };
            waiters.push(check);
            check();
          }),
      }),
    );
  });
}

describe("WebSocket /ws", () => {
  let h: Harness;
  let base: string;

  beforeAll(async () => {
    h = await startHarness();
    const app = await h.app();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as { port: number };
    base = `ws://127.0.0.1:${addr.port}/ws`;
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  const nonStatus = (c: Client) => c.messages.filter((m) => m.type !== "indexer.status");

  it("starts with a hello that carries the current sequence number", async () => {
    const c = await connect(base);
    await c.waitFor(1);
    const hello = WsHelloSchema.parse(c.messages[0]);
    expect(hello).toMatchObject({ seq: h.bus.lastSeq, refetch: false, replayed: 0 });
    c.close();
  });

  it("pushes live messages with increasing sequence numbers", async () => {
    const c = await connect(base);
    await c.waitFor(1);
    await h.call(0, "registerProduct", "Laptop");
    await h.indexer.syncOnce();
    await c.waitFor(5);

    const live = c.messages.slice(1).map((m) => WsMessageSchema.parse(m));
    const seqs = live.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const types = live.map((m) => m.type);
    expect(types).toContain("block.new");
    expect(types).toContain("tx.mined");
    expect(types).toContain("record.appended");
    c.close();
  });

  it("replays exactly what a reconnecting client missed", async () => {
    const first = await connect(base);
    await first.waitFor(1);
    const lastSeen = h.bus.lastSeq;
    first.close();
    await first.closed;

    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
    const expected = h.bus.since(lastSeen)!.map((m) => m.seq);
    expect(expected.length).toBeGreaterThan(2);

    const second = await connect(`${base}?since=${lastSeen}`);
    await second.waitFor(1 + expected.length);
    const hello = WsHelloSchema.parse(second.messages[0]);
    expect(hello).toMatchObject({ refetch: false, replayed: expected.length });
    expect(second.messages.slice(1).map((m) => m.seq)).toEqual(expected);
    second.close();
  });

  it("does not duplicate messages published while the replay is being sent", async () => {
    const lastSeen = h.bus.lastSeq - 3;
    const c = await connect(`${base}?since=${lastSeen}`);
    h.bus.publish("block.new", { n: "extra" });
    await c.waitFor(1 + 4);
    await new Promise((r) => setTimeout(r, 100));
    const seqs = c.messages.slice(1).map((m) => m.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.at(-1)).toBe(h.bus.lastSeq);
    c.close();
  });

  it("tells a client to refetch when the buffer no longer reaches back", async () => {
    for (let i = 0; i < 2100; i++) h.bus.publish("block.new", { filler: i });
    const c = await connect(`${base}?since=1`);
    await c.waitFor(1);
    expect(WsHelloSchema.parse(c.messages[0])).toMatchObject({ refetch: true, replayed: 0 });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.messages).toHaveLength(1); // nothing replayed
    c.close();
  });

  it("tells a client from a previous backend run (sequence ahead of the server) to refetch", async () => {
    const c = await connect(`${base}?since=${h.bus.lastSeq + 1000}`);
    await c.waitFor(1);
    expect(WsHelloSchema.parse(c.messages[0]).refetch).toBe(true);
    c.close();
  });

  it("ignores a malformed since parameter", async () => {
    const c = await connect(`${base}?since=abc`);
    await c.waitFor(1);
    expect(WsHelloSchema.parse(c.messages[0])).toMatchObject({ refetch: false, replayed: 0 });
    c.close();
  });

  it("fans out to several clients and answers ping", async () => {
    const a = await connect(base);
    const b = await connect(base);
    await Promise.all([a.waitFor(1), b.waitFor(1)]);
    a.send({ type: "ping" });
    await a.waitFor(2);
    expect(a.messages[1]).toMatchObject({ type: "pong" });

    h.bus.publish("mining.changed", { automine: false });
    await Promise.all([a.waitFor(3), b.waitFor(2)]);
    expect(nonStatus(a).at(-1)).toMatchObject({ type: "mining.changed" });
    expect(nonStatus(b).at(-1)).toMatchObject({ type: "mining.changed" });
    a.close(); b.close();
  });

  it("stops listening when a client disconnects", async () => {
    // earlier tests closed their sockets; give the server a moment to notice before taking the baseline
    await new Promise((r) => setTimeout(r, 300));
    const before = h.bus.listenerCount;
    const c = await connect(base);
    await c.waitFor(1);
    expect(h.bus.listenerCount).toBe(before + 1);
    c.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 100));
    expect(h.bus.listenerCount).toBe(before);
  });

  it("survives garbage from the client", async () => {
    const c = await connect(base);
    await c.waitFor(1);
    c.send("not even an object");
    c.send({ type: "unknown" });
    c.send({ type: "ping" });
    await c.waitFor(2);
    expect(c.messages.at(-1)).toMatchObject({ type: "pong" });
    c.close();
  });
});
