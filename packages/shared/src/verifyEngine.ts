import { computeHash } from "./hashRecipe";
import type { VerificationStatus } from "./status";
import { GENESIS_HASH, type EventWitness, type LedgerRecord } from "./types";

/** Result of the three independent checks on one record. */
export interface RecordCheck {
  index: bigint;
  /** Recomputed hash equals the stored hash: the record's data was not edited. */
  dataOk: boolean;
  /** prevHash equals the stored hash of the record before it. */
  linkOk: boolean;
  /** Stored prevHash/hash equal the RecordAppended event; `null` when no event was supplied. */
  anchorOk: boolean | null;
  /** What the contract's own `verifyLedger` / `auditRange` can see: data and link only. */
  onChainStatus: Extract<VerificationStatus, "intact" | "dataTampered" | "linkBroken">;
  /** Full verdict including the event-log anchor. */
  status: VerificationStatus;
  /** The hash the data should have, and the hash the link should point to. */
  recomputedHash: string;
  expectedPrevHash: string | null;
  /** Same bitmask as the contract's `auditRange`: 1 = data mismatch, 2 = link mismatch. */
  reasonMask: number;
  /** Plain-English reasons, empty when intact. */
  reasons: string[];
}

export interface VerificationResult {
  checks: RecordCheck[];
  /** Every record passed all three checks. */
  valid: boolean;
  /** Index of the first record that fails any check (including the event anchor). */
  firstBrokenAt: bigint | null;
  /** Index of the first record the contract itself would flag (data or link only). */
  firstBrokenOnChainAt: bigint | null;
  brokenIndexes: bigint[];
}

export interface VerifyOptions {
  /** Event-log witnesses, keyed by record index (array or map). */
  witnesses?: EventWitness[] | Map<bigint, EventWitness>;
  /** Stored hash of the record before `records[0]`. Defaults to the genesis hash when `records[0].index` is 0. */
  previousHash?: string;
}

function witnessMap(w: VerifyOptions["witnesses"]): Map<bigint, EventWitness> | undefined {
  if (!w) return undefined;
  return w instanceof Map ? w : new Map(w.map((e) => [e.index, e]));
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function checkOne(
  record: LedgerRecord,
  expectedPrev: string | null,
  witness: EventWitness | undefined,
  hasWitnesses: boolean,
): RecordCheck {
  const recomputedHash = computeHash(record);
  const dataOk = same(recomputedHash, record.hash);
  const linkOk = expectedPrev === null ? true : same(record.prevHash, expectedPrev);
  const anchorOk = !hasWitnesses
    ? null
    : witness
      ? same(witness.hash, record.hash) &&
        same(witness.prevHash, record.prevHash) &&
        witness.productId === record.productId &&
        witness.action === record.action &&
        same(witness.actor, record.actor)
      : null;

  const onChainStatus = !dataOk ? "dataTampered" : !linkOk ? "linkBroken" : "intact";
  const status: VerificationStatus = onChainStatus !== "intact" ? onChainStatus : anchorOk === false ? "anchorMismatch" : "intact";

  const reasons: string[] = [];
  if (!dataOk) reasons.push("The hash recomputed from this record's fields does not match the stored hash.");
  if (!linkOk) reasons.push("prevHash does not match the stored hash of the previous record.");
  if (anchorOk === false) reasons.push("The stored hashes differ from the RecordAppended event emitted when it was written.");

  return {
    index: record.index,
    dataOk,
    linkOk,
    anchorOk,
    onChainStatus,
    status,
    recomputedHash,
    expectedPrevHash: expectedPrev,
    reasonMask: (dataOk ? 0 : 1) | (linkOk ? 0 : 2),
    reasons,
  };
}

function summarize(checks: RecordCheck[]): VerificationResult {
  const broken = checks.filter((c) => c.status !== "intact");
  const onChainBroken = checks.find((c) => c.onChainStatus !== "intact");
  return {
    checks,
    valid: broken.length === 0,
    firstBrokenAt: broken[0]?.index ?? null,
    firstBrokenOnChainAt: onChainBroken?.index ?? null,
    brokenIndexes: broken.map((c) => c.index),
  };
}

/** Verifies a contiguous run of records, as an outside auditor would. */
export function verifyRecords(records: LedgerRecord[], options: VerifyOptions = {}): VerificationResult {
  const witnesses = witnessMap(options.witnesses);
  const first = records[0];
  let expectedPrev: string | null =
    options.previousHash ?? (first && first.index === 0n ? GENESIS_HASH : null);

  const checks: RecordCheck[] = [];
  for (const record of records) {
    checks.push(checkOne(record, expectedPrev, witnesses?.get(record.index), witnesses !== undefined));
    expectedPrev = record.hash;
  }
  return summarize(checks);
}

/**
 * Re-verifies only from position `startAt` onward, reusing earlier results. Use it when new records
 * arrive: a record's checks depend only on itself and the one before it.
 */
export function verifyIncremental(
  previous: VerificationResult,
  records: LedgerRecord[],
  startAt: number,
  options: VerifyOptions = {},
): VerificationResult {
  const kept = previous.checks.slice(0, startAt);
  const tail = records.slice(startAt);
  const prevRecord = records[startAt - 1];
  const redone = verifyRecords(tail, {
    witnesses: options.witnesses,
    previousHash: prevRecord ? prevRecord.hash : options.previousHash,
  });
  return summarize([...kept, ...redone.checks]);
}

/** What the contract answered, for side-by-side comparison. */
export interface ContractVerdict {
  valid: boolean;
  brokenAt: bigint;
  /** Result of `auditRange(0, length)`, when available. */
  audit?: { brokenIndexes: bigint[]; reasons: number[] };
}

export interface Comparison {
  /** The contract and this engine agree on the first broken record (as the contract sees it). */
  agree: boolean;
  /** The engine found problems the contract's own check cannot see. */
  contractFooled: boolean;
  notes: string[];
}

/** Compares the off-chain verdict with `verifyLedger()` / `auditRange()`. */
export function compareWithContract(result: VerificationResult, contract: ContractVerdict): Comparison {
  const notes: string[] = [];
  const engineOnChain = result.firstBrokenOnChainAt;
  const contractFirst = contract.valid ? null : contract.brokenAt;
  const agree = engineOnChain === contractFirst;

  if (!agree) {
    notes.push(
      `The contract reports the first problem at ${contractFirst ?? "none"}, this engine at ${engineOnChain ?? "none"}.`,
    );
  }

  const contractFooled = contract.valid && !result.valid;
  if (contractFooled) {
    notes.push(
      "verifyLedger() says the ledger is valid, but the event log disagrees with storage from record #" +
        `${result.firstBrokenAt}. A self-consistent rewrite cannot be detected from inside the contract.`,
    );
  }

  if (contract.audit) {
    const engineList = result.checks.filter((c) => c.onChainStatus !== "intact");
    const sameList =
      engineList.length === contract.audit.brokenIndexes.length &&
      engineList.every((c, i) => c.index === contract.audit!.brokenIndexes[i] && c.reasonMask === contract.audit!.reasons[i]);
    if (!sameList) notes.push("auditRange() lists different records or reasons than this engine.");
  }
  return { agree, contractFooled, notes };
}
