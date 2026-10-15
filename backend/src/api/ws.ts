import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WsHello } from "@dpp/shared";
import type { BusMessage } from "../bus";
import type { Services } from "../services";

/** A client this far behind is dropped and told to refetch, rather than letting memory grow without bound. */
const MAX_BUFFERED_BYTES = 1_000_000;
const PING_EVERY_MS = 20_000;

export async function registerWebSocket(app: FastifyInstance, s: Services): Promise<void> {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket, req) => {
    const raw = (req.query as { since?: string }).since;
    const since = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;

    let lastSent = 0;
    let replaying = true;
    const queued: BusMessage[] = [];

    const send = (payload: unknown): boolean => {
      if (socket.readyState !== socket.OPEN) return false;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.close(1013, "too slow: refetch over REST");
        return false;
      }
      socket.send(JSON.stringify(payload));
      return true;
    };
    const deliver = (m: BusMessage) => {
      if (m.seq <= lastSent) return; // already sent while replaying
      lastSent = m.seq;
      send(m);
    };

    // Subscribe first, so nothing published during the replay is lost; deliver it afterwards.
    const unsubscribe = s.bus.subscribe((m) => (replaying ? queued.push(m) : deliver(m)));

    const head = s.bus.lastSeq;
    // A client that is ahead of the server saw a previous run of the backend: its history is gone.
    const replay = since === null ? [] : since > head ? null : s.bus.since(since);
    const hello: WsHello = {
      type: "hello",
      seq: head,
      refetch: since !== null && replay === null,
      replayed: replay?.length ?? 0,
      serverTime: Date.now(),
    };
    send(hello);
    lastSent = head;

    if (replay) {
      lastSent = since!;
      for (const m of replay) deliver(m);
      lastSent = Math.max(lastSent, head);
    }
    replaying = false;
    for (const m of queued) deliver(m);
    queued.length = 0;

    socket.on("message", (data: Buffer) => {
      try {
        if (JSON.parse(data.toString()).type === "ping") send({ type: "pong", serverTime: Date.now() });
      } catch {
        // ignore anything that is not JSON
      }
    });

    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_EVERY_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
