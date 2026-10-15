import { verifyIncremental, verifyRecords, type EventWitness, type LedgerRecord, type VerificationResult } from "@dpp/shared";
import type { Bus } from "./bus";
import type { RecordRow, Repo } from "./db/repo";

export const rowToRecord = (r: RecordRow): LedgerRecord => ({
  index: r.index, timestamp: r.timestamp, productId: r.productId, action: r.action as LedgerRecord["action"],
  actor: r.actor, counterparty: r.counterparty, price: r.price, prevHash: r.prevHash, hash: r.hash,
});

/** The event log's claim about a record, or null if no event was indexed for it. */
export const rowToWitness = (r: RecordRow): EventWitness | null =>
  r.eventHash && r.eventPrevHash && r.eventProductId !== null && r.eventAction !== null && r.eventActor
    ? {
        index: r.index, productId: r.eventProductId, action: r.eventAction as EventWitness["action"],
        actor: r.eventActor, prevHash: r.eventPrevHash, hash: r.eventHash,
      }
    : null;

export interface VerificationSummary {
  valid: boolean;
  recordCount: number;
  firstBrokenAt: string | null;
  firstBrokenOnChainAt: string | null;
  brokenIndexes: string[];
}

/**
 * Verifies the indexed ledger with the same engine the browser uses. The result is cached and
 * recomputed after each indexer pass; a message is published only when the verdict actually changes.
 */
export class VerificationService {
  private result: VerificationResult | null = null;
  private count = 0;
  private lastSummary = "";

  constructor(private readonly repo: Repo, private readonly bus: Bus) {}

  private build(rows: RecordRow[], appendedFrom: number | null): VerificationResult {
    const records = rows.map(rowToRecord);
    const witnesses = rows.map(rowToWitness).filter((w): w is EventWitness => w !== null);
    if (appendedFrom !== null && this.result && appendedFrom === this.count && this.count > 0) {
      return verifyIncremental(this.result, records, appendedFrom, { witnesses });
    }
    return verifyRecords(records, { witnesses });
  }

  /**
   * Recomputes the verdict. Pass `appendedFrom` (the previous record count) when records were only
   * appended, to re-check just the new ones; omit it after tampering, a rewind or a reset.
   */
  refresh(appendedFrom: number | null = null): VerificationResult {
    const rows = this.repo.allRecords();
    this.result = this.build(rows, appendedFrom);
    this.count = rows.length;

    const s = this.summary();
    const key = JSON.stringify(s);
    if (key !== this.lastSummary) {
      this.lastSummary = key;
      this.bus.publish("verification.changed", s);
    }
    return this.result;
  }

  get(): VerificationResult {
    return this.result ?? this.refresh();
  }

  summary(): VerificationSummary {
    const r = this.result ?? this.refresh();
    return {
      valid: r.valid,
      recordCount: r.checks.length,
      firstBrokenAt: r.firstBrokenAt?.toString() ?? null,
      firstBrokenOnChainAt: r.firstBrokenOnChainAt?.toString() ?? null,
      brokenIndexes: r.brokenIndexes.map(String),
    };
  }
}
