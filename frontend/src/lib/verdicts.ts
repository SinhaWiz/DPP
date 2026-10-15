import type { ApiVerify, VerificationResult } from "@dpp/shared";

export type Level = 1 | 2 | 3 | 4;

export interface LevelInfo {
  level: Level;
  title: string;
  mode: "data" | "data+hash" | "rewrite-tail";
  /** What the attacker does. */
  idea: string;
  /** Said before the attack runs, so the learner can predict. */
  expect: (i: number, j?: number) => string;
  /** Said after it ran. */
  lesson: string;
}

export const LEVELS: LevelInfo[] = [
  {
    level: 1, title: "Edit the data", mode: "data",
    idea: "Change one field of one stored record, and leave its stored hash alone.",
    expect: (i) => `Record #${i}'s hash will no longer match its own data, so it is flagged. The records around it are untouched, and every link still looks fine, because the next record still points at the hash that is stored.`,
    lesson: "A hash is a fingerprint of the data. Change the data and the fingerprint no longer fits. Notice that only the edited record is flagged: nothing else was touched.",
  },
  {
    level: 2, title: "Edit the data and fix its hash", mode: "data+hash",
    idea: "A smarter attacker also recomputes the record's hash so it matches the edited data.",
    expect: (i) => `Record #${i} now looks perfectly consistent on its own. But record #${i + 1} still carries the old hash as its prevHash, so the link ${i}→${i + 1} breaks and the contract flags #${i + 1}. The event log, which cannot be edited, also exposes #${i} itself.`,
    lesson: "Each record locks in the one before it. Fixing one hash moves the problem to the next record, so the attacker must keep going.",
  },
  {
    level: 3, title: "Rewrite the whole tail", mode: "rewrite-tail",
    idea: "The most thorough attacker recomputes every hash and link from the edited record to the end of the chain.",
    expect: (i) => `Everything from #${i} onward is now internally consistent, so the contract's own verifyLedger() reports the ledger as valid. The browser's check, which compares against the RecordAppended events in the transaction logs, still catches it.`,
    lesson: "A hash chain proves consistency, not authenticity. A complete rewrite passes every check made inside the contract. Only something the attacker cannot rewrite, the event log, gives it away. On a real blockchain, the blocks themselves play that role.",
  },
  {
    level: 4, title: "Two separate edits", mode: "data",
    idea: "Tamper with two records that are not next to each other.",
    expect: (i, j) => `verifyLedger() stops at the first problem and reports only #${i}. auditRange() and the browser's check list both #${i} and #${j ?? i + 2}.`,
    lesson: "verifyLedger answers \"is it intact?\" cheaply and reports only the first break. To find everything that was changed you need auditRange or a full audit.",
  },
];

export const levelInfo = (level: Level): LevelInfo => LEVELS[level - 1]!;

export interface VerdictRow {
  id: "verifyLedger" | "auditRange" | "browser";
  who: string;
  ok: boolean;
  summary: string;
}

/** The three verdicts side by side. */
export function verdictRows(verify: ApiVerify, browser: VerificationResult): VerdictRow[] {
  const rows: VerdictRow[] = [];
  const c = verify.onChain;
  rows.push(
    c
      ? { id: "verifyLedger", who: "Contract: verifyLedger()", ok: c.valid, summary: c.valid ? "valid" : `invalid; first problem at record #${c.brokenAt}` }
      : { id: "verifyLedger", who: "Contract: verifyLedger()", ok: true, summary: "not available" },
    c
      ? { id: "auditRange", who: "Contract: auditRange(0, length)", ok: c.audit.brokenIndexes.length === 0, summary: c.audit.brokenIndexes.length === 0 ? "no broken records" : `broken: ${c.audit.brokenIndexes.map((i) => `#${i}`).join(", ")}` }
      : { id: "auditRange", who: "Contract: auditRange(0, length)", ok: true, summary: "not available" },
  );
  rows.push({
    id: "browser", who: "Your browser: full audit", ok: browser.valid,
    summary: browser.valid ? "all records intact" : `broken: ${browser.brokenIndexes.map((i) => `#${i}`).join(", ")} (first at #${browser.firstBrokenAt})`,
  });
  return rows;
}

/** Why the verdicts differ, in plain English. Empty when they all agree. */
export function explainDifferences(verify: ApiVerify, browser: VerificationResult): string[] {
  const out: string[] = [];
  const c = verify.onChain;
  if (!c) return out;

  if (c.valid && !browser.valid) {
    out.push(`The contract says the ledger is valid, but your browser found ${browser.brokenIndexes.length} problem${browser.brokenIndexes.length === 1 ? "" : "s"}, starting at record #${browser.firstBrokenAt}. The stored data is consistent with itself, but it no longer matches what the contract announced in its event log when it wrote the records. Only the log, which cannot be rewritten, shows it.`);
    return out;
  }
  if (!c.valid && c.audit.brokenIndexes.length > 1) {
    out.push(`verifyLedger() stops at the first problem (record #${c.brokenAt}). auditRange() lists all ${c.audit.brokenIndexes.length} broken records.`);
  }
  const contractSet = new Set(c.audit.brokenIndexes);
  const extra = browser.brokenIndexes.map(String).filter((i) => !contractSet.has(i));
  if (!c.valid && extra.length > 0) {
    out.push(`Your browser also flags ${extra.map((i) => `#${i}`).join(", ")}, which the contract cannot see: those records still pass its data and link checks, but their stored hashes differ from the event log.`);
  }
  return out;
}
