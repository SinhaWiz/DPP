import { WsHelloSchema, WsMessageSchema, type WsHello, type WsMessage } from "@dpp/shared";

export type SocketStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onMessage(message: WsMessage): void;
  /** Fired after (re)connecting. `refetch` means history could not be replayed: reload over REST. */
  onHello(hello: WsHello): void;
  onStatus(status: SocketStatus): void;
}

export interface SocketOptions {
  url: string;
  handlers: SocketHandlers;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  minDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

/**
 * A WebSocket that reconnects on its own with exponential backoff and tells the server the last
 * sequence number it saw, so the server replays whatever was missed. If the server cannot (it
 * restarted, or the gap is too large) it says `refetch`, and the caller reloads over REST.
 */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private lastSeq = 0;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private status: SocketStatus = "closed";

  constructor(private readonly o: SocketOptions) {}

  get seq(): number {
    return this.lastSeq;
  }

  get state(): SocketStatus {
    return this.status;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    (this.o.clearTimer ?? clearTimeout)(this.timer ?? undefined);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  /** Sends a ping; the server answers with a pong message. Handy to check the link is alive. */
  ping(): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: "ping" }));
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.o.handlers.onStatus(s);
  }

  private open() {
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    this.setStatus("connecting");
    const url = this.lastSeq > 0 ? `${this.o.url}${this.o.url.includes("?") ? "&" : "?"}since=${this.lastSeq}` : this.o.url;

    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
    };
    ws.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const hello = WsHelloSchema.safeParse(data);
      if (hello.success) {
        this.setStatus("open");
        if (hello.data.refetch) this.lastSeq = hello.data.seq; // our history is gone; start from the server's head
        this.o.handlers.onHello(hello.data);
        return;
      }
      const msg = WsMessageSchema.safeParse(data);
      if (!msg.success) return; // pong and anything unknown
      if (msg.data.seq <= this.lastSeq) return; // a duplicate from a replay
      this.lastSeq = msg.data.seq;
      this.o.handlers.onMessage(msg.data);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles the retry
    };
  }

  private scheduleReconnect() {
    if (this.stopped || this.timer) return;
    const min = this.o.minDelayMs ?? 500;
    const max = this.o.maxDelayMs ?? 10_000;
    const exp = Math.min(max, min * 2 ** this.attempts);
    const jitter = 0.5 + (this.o.random ?? Math.random)() / 2; // 50 to 100 % of the delay
    this.attempts++;
    this.timer = (this.o.setTimer ?? setTimeout)(() => {
      this.timer = null;
      if (!this.stopped) this.open();
    }, Math.round(exp * jitter));
  }
}

/** ws:// or wss:// URL for /ws on the page's own origin (the dev server proxies it to the backend). */
export function defaultSocketUrl(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/ws`;
}
