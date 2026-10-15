import type { RecordCheck } from "@dpp/shared";
import type { RecordRow, TxRow } from "../db/repo";

export type StageKey = "pending" | "mined" | "recorded" | "verified" | "failed" | "explained" | "replaced" | "dropped";

export interface TxStage {
  key: StageKey;
  label: string;
  /** Milliseconds since the epoch, when the stage happened; null if it has not. */
  at: number | null;
  done: boolean;
  /** The stage the transaction is in now. */
  current: boolean;
  /** Stage data for the details panel (strings, so it serializes as is). */
  detail: Record<string, string | null>;
}

/**
 * The ordered stages a transaction has been through (and, for a pending one, those still ahead).
 * `record` is the ledger record it appended, if any; `check` is that record's verification result.
 */
export function buildStages(tx: TxRow, record: RecordRow | null, check?: RecordCheck): TxStage[] {
  const stage = (s: Omit<TxStage, "current">): TxStage => ({ ...s, current: false });
  const pending = stage({
    key: "pending", label: "Pending in the mempool", at: tx.firstSeenAt, done: true,
    detail: { nonce: String(tx.nonce), maxFee: tx.maxFee, maxPriorityFee: tx.maxPriorityFee, gasLimit: tx.gasLimit },
  });

  let stages: TxStage[];
  switch (tx.lifecycleState) {
    case "pending":
      stages = [
        pending,
        stage({ key: "mined", label: "Mined", at: null, done: false, detail: {} }),
      ];
      break;

    case "replaced":
      stages = [
        pending,
        stage({ key: "replaced", label: "Replaced", at: null, done: true, detail: { replacedBy: tx.replacedBy } }),
      ];
      break;

    case "dropped":
      stages = [pending, stage({ key: "dropped", label: "Dropped", at: null, done: true, detail: {} })];
      break;

    case "failed":
      stages = [
        pending,
        stage({
          key: "mined", label: "Mined (reverted)", at: tx.minedAt, done: true,
          detail: { block: String(tx.blockNumber), status: "0", gasUsed: tx.gasUsed },
        }),
        stage({
          key: "explained", label: "Reverted: nothing recorded", at: tx.minedAt, done: true,
          detail: { error: tx.revertName, approximate: tx.revertApprox ? "true" : "false" },
        }),
      ];
      break;

    default: {
      // mined successfully
      stages = [
        pending,
        stage({
          key: "mined", label: "Mined", at: tx.minedAt, done: true,
          detail: { block: String(tx.blockNumber), status: "1", gasUsed: tx.gasUsed },
        }),
      ];
      if (record) {
        stages.push(
          stage({
            key: "recorded", label: "Ledger record appended", at: tx.minedAt, done: true,
            detail: { index: record.index.toString(), hash: record.hash, prevHash: record.prevHash },
          }),
          stage({
            key: "verified",
            label: check && check.status !== "intact" ? "Record failed verification" : "Record verified",
            at: tx.minedAt,
            done: check !== undefined,
            detail: { status: check?.status ?? null },
          }),
        );
      }
    }
  }

  // the current stage is the last one that has happened
  const lastDone = [...stages].reverse().find((s) => s.done);
  if (lastDone) lastDone.current = true;
  return stages;
}
