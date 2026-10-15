/**
 * In-process message bus. Every message gets a sequence number and is kept in a ring buffer, so a
 * WebSocket client that reconnects can ask for everything after the last `seq` it saw.
 */

export type MessageType =
  | "block.new"
  | "tx.pending"
  | "tx.mined"
  | "tx.failed"
  | "tx.replaced"
  | "tx.dropped"
  | "record.appended"
  | "verification.changed"
  | "chain.rewound"
  | "chain.reset"
  | "lab.tampered"
  | "lab.restored"
  | "mining.changed"
  | "indexer.status";

export interface BusMessage<T = unknown> {
  seq: number;
  type: MessageType;
  at: number;
  data: T;
}

type Listener = (message: BusMessage) => void;

export class Bus {
  private seq = 0;
  private readonly buffer: BusMessage[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(private readonly capacity = 2000) {}

  publish<T>(type: MessageType, data: T): BusMessage<T> {
    const message: BusMessage<T> = { seq: ++this.seq, type, at: Date.now(), data };
    this.buffer.push(message);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const l of this.listeners) {
      try {
        l(message);
      } catch {
        // a faulty subscriber must not break the publisher
      }
    }
    return message;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get lastSeq(): number {
    return this.seq;
  }

  /**
   * Messages after `since`. Returns `null` when the buffer no longer reaches back that far, which
   * tells the client to refetch everything instead of replaying.
   */
  since(since: number): BusMessage[] | null {
    if (since >= this.seq) return [];
    const oldest = this.buffer[0];
    if (!oldest || since < oldest.seq - 1) return null;
    return this.buffer.filter((m) => m.seq > since);
  }
}
