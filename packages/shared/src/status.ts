/** Verification and lifecycle vocabularies, with the colours/icons from docs/DESIGN_TOKENS.md. */

export type VerificationStatus = "intact" | "dataTampered" | "linkBroken" | "anchorMismatch";

export interface StatusMeta {
  label: string;
  color: string;
  icon: string;
  dashed?: boolean;
  summary: string;
}

export const VERIFICATION_META: Record<VerificationStatus, StatusMeta> = {
  intact: {
    label: "Intact",
    color: "#16a34a",
    icon: "✔",
    summary: "Hash matches the data, the link matches the previous hash, and the event log agrees.",
  },
  dataTampered: {
    label: "Data tampered",
    color: "#dc2626",
    icon: "✘",
    summary: "The hash recomputed from this record's fields differs from the hash stored with it.",
  },
  linkBroken: {
    label: "Link broken",
    color: "#dc2626",
    icon: "⛓",
    dashed: true,
    summary: "This record's prevHash differs from the stored hash of the record before it.",
  },
  anchorMismatch: {
    label: "Log mismatch",
    color: "#9333ea",
    icon: "⚓",
    summary: "The stored hashes disagree with the RecordAppended event, which cannot be rewritten.",
  },
};

export type TxLifecycleState =
  | "pending"
  | "mined"
  | "recorded"
  | "verified"
  | "failed"
  | "replaced"
  | "dropped";

export const LIFECYCLE_META: Record<TxLifecycleState, StatusMeta> = {
  pending: { label: "Pending", color: "#d97706", icon: "⏳", summary: "Sent, waiting in the mempool for a block." },
  mined: { label: "Mined", color: "#2563eb", icon: "✔", summary: "Included in an Ethereum block and executed successfully." },
  recorded: { label: "Recorded", color: "#16a34a", icon: "⛓", summary: "A ledger record was appended by this transaction." },
  verified: { label: "Verified", color: "#16a34a", icon: "✔", summary: "The new record passed all integrity checks." },
  failed: { label: "Failed", color: "#dc2626", icon: "✘", summary: "Mined but reverted. Gas was spent; nothing was recorded." },
  replaced: { label: "Replaced", color: "#6b7280", icon: "⇄", summary: "Another transaction with the same nonce was mined instead." },
  dropped: { label: "Dropped", color: "#6b7280", icon: "⌫", dashed: true, summary: "Removed from the mempool before being mined." },
};
