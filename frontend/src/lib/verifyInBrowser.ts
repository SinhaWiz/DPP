import {
  verifyRecords, toLedgerRecord, type ApiRecord, type EventWitness, type LedgerRecord, type VerificationResult, type VerificationStatus,
} from "@dpp/shared";

export function apiToLedgerRecord(r: ApiRecord): LedgerRecord {
  return toLedgerRecord({
    index: r.index, timestamp: r.timestamp, productId: r.productId, action: r.action, actor: r.actor,
    counterparty: r.counterparty, price: r.price, prevHash: r.prevHash, hash: r.hash,
  });
}

export function apiToWitness(r: ApiRecord): EventWitness | null {
  const w = r.witness;
  if (!w) return null;
  return { index: BigInt(r.index), productId: BigInt(w.productId), action: w.action as EventWitness["action"], actor: w.actor, prevHash: w.prevHash, hash: w.hash };
}

/**
 * Verifies the ledger in the browser with the same engine the server uses, from the records the
 * server sent. The server's verdict is a convenience; this is the check you can rely on.
 */
export function verifyInBrowser(records: ApiRecord[]): VerificationResult {
  const witnesses = records.map(apiToWitness).filter((w): w is EventWitness => w !== null);
  return verifyRecords(records.map(apiToLedgerRecord), { witnesses });
}

export interface Disagreement {
  index: string;
  browser: VerificationStatus;
  server: VerificationStatus;
}

export interface Comparison {
  agree: boolean;
  diffs: Disagreement[];
}

/** Where the browser's own verdict differs from what the server reported for each record. */
export function compareWithServer(local: VerificationResult, records: ApiRecord[]): Comparison {
  const diffs: Disagreement[] = [];
  records.forEach((r, i) => {
    const mine = local.checks[i];
    if (!mine) return;
    if (mine.status !== r.check.status) diffs.push({ index: r.index, browser: mine.status, server: r.check.status });
  });
  return { agree: diffs.length === 0, diffs };
}
