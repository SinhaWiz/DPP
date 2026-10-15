import { describe, expect, it, vi } from "vitest";
import { LiveSocket, defaultSocketUrl } from "./socket";

/** A controllable stand-in for WebSocket. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  // test controls
  open() { this.readyState = 1; this.onopen?.(); }
  push(v: unknown) { this.onmessage?.({ data: JSON.stringify(v) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

const hello = (seq: number, extra: object = {}) => ({ type: "hello", seq, refetch: false, replayed: 0, serverTime: 1, ...extra });
const msg = (seq: number, type = "block.new") => ({ seq, type, at: 1, data: { n: seq } });

function setup(opts: object = {}) {
  FakeSocket.instances = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const handlers = { onMessage: vi.fn(), onHello: vi.fn(), onStatus: vi.fn() };
  const socket = new LiveSocket({
    url: "ws://h/ws", handlers, WebSocketImpl: FakeSocket as never, random: () => 1,
    setTimer: ((fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }) as never,
    clearTimer: (() => {}) as never,
    ...opts,
  });
  const last = () => FakeSocket.instances.at(-1)!;
  return { socket, handlers, timers, last };
}

describe("LiveSocket", () => {
  it("connects, reports status, and delivers hello then messages in order", () => {
    const { socket, handlers, last } = setup();
    socket.start();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("connecting");
    expect(last().url).toBe("ws://h/ws");

    last().open();
    last().push(hello(5));
    expect(handlers.onStatus).toHaveBeenLastCalledWith("open");
    expect(handlers.onHello).toHaveBeenCalledWith(expect.objectContaining({ seq: 5, refetch: false }));

    last().push(msg(6));
    last().push(msg(7));
    expect(handlers.onMessage.mock.calls.map((c) => c[0].seq)).toEqual([6, 7]);
    expect(socket.seq).toBe(7);
  });

  it("ignores duplicates and out-of-order replays", () => {
    const { socket, handlers, last } = setup();
    socket.start();
    last().push(hello(0));
    last().push(msg(3));
    last().push(msg(3));
    last().push(msg(2));
    last().push(msg(4));
    expect(handlers.onMessage.mock.calls.map((c) => c[0].seq)).toEqual([3, 4]);
  });

  it("ignores pongs, garbage and unknown message types", () => {
    const { socket, handlers, last } = setup();
    socket.start();
    last().push({ type: "pong", serverTime: 1 });
    last().push({ seq: 1, type: "unheard.of", at: 1, data: null });
    last().onmessage?.({ data: "not json" });
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it("reconnects with backoff after a drop and asks to resume from the last sequence number", () => {
    const { socket, handlers, timers, last } = setup();
    socket.start();
    last().push(hello(0));
    last().push(msg(9));
    last().drop();

    expect(handlers.onStatus).toHaveBeenLastCalledWith("closed");
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(500);

    timers[0]!.fn();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(last().url).toBe("ws://h/ws?since=9");
  });

  it("backs off exponentially up to a ceiling, and resets after a successful connection", () => {
    const { socket, timers, last } = setup({ minDelayMs: 100, maxDelayMs: 800 });
    socket.start();
    for (let i = 0; i < 6; i++) {
      last().drop();
      timers.at(-1)!.fn();
    }
    last().drop();
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 400, 800, 800, 800, 800]);

    timers.at(-1)!.fn();
    last().open(); // a successful connection resets the backoff
    last().drop();
    expect(timers.at(-1)!.ms).toBe(100);
  });

  it("applies jitter between 50 and 100 percent of the delay", () => {
    const { socket, timers, last } = setup({ random: () => 0 });
    socket.start();
    last().drop();
    expect(timers[0]!.ms).toBe(250);
  });

  it("passes a refetch signal on and restarts its numbering from the server's head", () => {
    const { socket, handlers, timers, last } = setup();
    socket.start();
    last().push(hello(0));
    last().push(msg(40));
    last().drop();
    timers[0]!.fn();
    last().push(hello(3, { refetch: true })); // server restarted: our 40 means nothing to it
    expect(handlers.onHello).toHaveBeenLastCalledWith(expect.objectContaining({ refetch: true }));
    expect(socket.seq).toBe(3);
    last().push(msg(4));
    expect(handlers.onMessage).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 4 }));
  });

  it("does not reconnect after stop()", () => {
    const { socket, timers, last, handlers } = setup();
    socket.start();
    last().push(hello(0));
    socket.stop();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("closed");
    expect(timers).toHaveLength(0);
    expect(socket.state).toBe("closed");
  });

  it("start() twice does not open two connections", () => {
    const { socket } = setup();
    socket.start();
    socket.start();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("can ping an open connection", () => {
    const { socket, last } = setup();
    socket.start();
    last().open();
    socket.ping();
    expect(JSON.parse(last().sent[0]!)).toEqual({ type: "ping" });
  });
});

describe("defaultSocketUrl", () => {
  it("follows the page's scheme and host", () => {
    expect(defaultSocketUrl({ protocol: "http:", host: "127.0.0.1:5173" })).toBe("ws://127.0.0.1:5173/ws");
    expect(defaultSocketUrl({ protocol: "https:", host: "lab.example" })).toBe("wss://lab.example/ws");
  });
});
