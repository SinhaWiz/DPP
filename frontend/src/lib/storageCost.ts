import type { ApiStorageRecord, ApiStorageWrite } from "@dpp/shared";

/** Gas of a LOG4 event with `dataBytes` of data: 375 base + 375 per topic (the signature plus three indexed values) + 8 per byte. */
export const logGas = (topics: number, dataBytes: number) => 375 + 375 * topics + 8 * dataBytes;

/** What `RecordAppended` costs: signature + index + productId + actor as topics, and action + prevHash + hash as data. */
export const EVENT_GAS = logGas(4, 96);

export type WriteKind = "new" | "update" | "warm" | "cleared" | "unchanged";

export interface CostedWrite {
  seq: number;
  /** Which of the record's eight slots, 0..7 */
  position: number;
  kind: WriteKind;
  gas: number | null;
  /** In words, why it cost that. */
  why: string;
  before: string;
  after: string;
}

export interface CostSummary {
  writes: CostedWrite[];
  /** Gas spent writing this record's own eight slots. */
  recordGas: number;
  /** Gas the whole transaction used, when known. */
  txGas: number | null;
  /** recordGas as a share of txGas (0..1), when both are known. */
  share: number | null;
  eventGas: number;
  /** How many times cheaper the event is than the storage writes. */
  ratio: number | null;
}

/** A write costs 100 gas when the slot was already written earlier in the same transaction ("warm" and "dirty"). */
function classify(w: ApiStorageWrite): { kind: WriteKind; why: string } {
  if (w.kind === "unchanged") return { kind: "unchanged", why: "The value did not change." };
  if (w.gasCost !== null && w.gasCost <= 200) return { kind: "warm", why: "This slot was already written earlier in the same transaction, so rewriting it is cheap (100 gas)." };
  if (w.kind === "new") {
    return {
      kind: "new",
      why: w.gasCost === 22100
        ? "A slot going from zero to non-zero: 20,000 gas to set it plus 2,100 for touching a slot for the first time in this transaction."
        : "A slot going from zero to non-zero: the most expensive kind of write.",
    };
  }
  if (w.kind === "cleared") return { kind: "cleared", why: "A slot going back to zero earns a gas refund." };
  return { kind: "update", why: "An existing non-zero value replaced by another: far cheaper than creating a new one." };
}

/** Which of the record's slots a storage write touched, by comparing absolute slot numbers. */
export function summarizeCost(data: ApiStorageRecord): CostSummary | null {
  if (data.storageWrites.length === 0) return null;
  const positionOf = new Map(data.slots.map((s) => [s.slot.toLowerCase(), s.position]));

  const writes: CostedWrite[] = data.storageWrites.map((w) => {
    const c = classify(w);
    return { seq: w.seq, position: positionOf.get(w.slot.toLowerCase()) ?? -1, kind: c.kind, gas: w.gasCost, why: c.why, before: w.before, after: w.after };
  });
  const recordGas = writes.reduce((n, w) => n + (w.gas ?? 0), 0);
  const txGas = data.writtenBy?.gasUsed ? Number(data.writtenBy.gasUsed) : null;
  return {
    writes, recordGas, txGas,
    share: txGas ? recordGas / txGas : null,
    eventGas: EVENT_GAS,
    ratio: recordGas > 0 ? recordGas / EVENT_GAS : null,
  };
}

// ───────────────────── three ways to read a record ─────────────────────

export interface ReadPath {
  id: "call" | "storage" | "log";
  title: string;
  how: string;
  hash: string | null;
  prevHash: string | null;
  /** Whether this path reads contract storage (the log does not, which is why it is an independent witness). */
  readsStorage: boolean;
}

export interface ReadComparison {
  paths: ReadPath[];
  /** All paths that have a value agree on both hashes. */
  agree: boolean;
  /** Paths whose hash differs from the majority, by id. */
  outliers: ReadPath["id"][];
}

/** The same record as returned by `getRecord`, read raw from storage, and as announced in the event log. */
export function compareReadPaths(data: ApiStorageRecord): ReadComparison {
  const slot = (position: number) => data.slots.find((s) => s.position === position)?.actual ?? null;
  const paths: ReadPath[] = [
    { id: "call", title: "Ask the contract", how: "getRecord(index): the contract reads its own storage and returns the decoded record.", hash: data.abiRecord?.hash ?? null, prevHash: data.abiRecord?.prevHash ?? null, readsStorage: true },
    { id: "storage", title: "Read the raw storage", how: "eth_getStorageAt on slots +6 and +7: the bytes themselves, no contract code involved.", hash: slot(7), prevHash: slot(6), readsStorage: true },
    { id: "log", title: "Read the event log", how: "The RecordAppended event emitted when the record was written. Logs are not in contract storage and cannot be edited later.", hash: data.witness?.hash ?? null, prevHash: data.witness?.prevHash ?? null, readsStorage: false },
  ];

  const known = paths.filter((p) => p.hash !== null);
  const counts = new Map<string, number>();
  for (const p of known) counts.set(p.hash!.toLowerCase(), (counts.get(p.hash!.toLowerCase()) ?? 0) + 1);
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const outliers = known.filter((p) => p.hash!.toLowerCase() !== majority).map((p) => p.id);
  const prevOk = new Set(known.map((p) => p.prevHash?.toLowerCase())).size <= 1;
  return { paths, agree: outliers.length === 0 && prevOk, outliers };
}
