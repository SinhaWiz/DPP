import type { LifecycleState } from "../db/repo";

/**
 * A transaction's life, as the backend observes it:
 *
 *   pending ──► mined          executed successfully
 *      │   └──► failed         mined but reverted (gas spent, nothing recorded)
 *      ├──────► replaced       another tx with the same sender and nonce took its place
 *      └──────► dropped        removed from the mempool without being mined
 *
 * Mined and failed are final for this node session. "Recorded" and "verified" are derived views of a
 * mined transaction (it appended a ledger record, and that record passed its checks), not stored states.
 */
export const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  pending: ["mined", "failed", "replaced", "dropped"],
  mined: [],
  failed: [],
  replaced: [],
  dropped: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isFinal(state: LifecycleState): boolean {
  return TRANSITIONS[state].length === 0;
}
