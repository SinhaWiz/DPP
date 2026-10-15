import { formatEth } from "./format";
import { FINAL_STAGES, type FlowTx } from "@/store/flowTypes";

export type NodeStatus = "done" | "current" | "failed" | "upcoming";
export type NodeKey = "draft" | "simulated" | "signed" | "pending" | "mined" | "recorded" | "verified" | "failed" | "replaced" | "dropped";

export interface PipelineNode {
  key: NodeKey;
  label: string;
  status: NodeStatus;
  /** Milliseconds since epoch, when known. */
  at: number | null;
  /** Facts for the details panel. */
  detail: [string, string][];
  /** What this stage means, for someone new to all of this. */
  explain: string;
}

const entered = (tx: FlowTx, ...stages: FlowTx["stage"][]) => tx.history.find((h) => stages.includes(h.stage))?.at ?? null;
const short = (s: string | null | undefined) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : "—");

/**
 * The stages one transaction goes through, in order, each marked done, current, failed or still ahead.
 * The first three happen in the browser; the rest are reported by the backend as the node mines it.
 */
export function pipelineNodes(tx: FlowTx): PipelineNode[] {
  const nodes: PipelineNode[] = [];
  const be = tx.backend;
  const beStage = (key: string) => be?.stages.find((s) => s.key === key);
  const stage = tx.stage;

  // 1. Draft: always happened.
  nodes.push({
    key: "draft", label: "Draft", status: "done", at: entered(tx, "draft"),
    detail: [
      ["Function", tx.signature],
      ...Object.entries(tx.shownArgs).map(([k, v]): [string, string] => [k, v]),
      ...(tx.value ? ([["Sends", `${formatEth(tx.value)} ETH`]] as [string, string][]) : []),
      ["Calldata", tx.calldata.length > 74 ? `${tx.calldata.slice(0, 74)}…` : tx.calldata],
    ],
    explain: `Your request is encoded as calldata: the first 4 bytes (${tx.selector}) select the function ${tx.signature}, and the rest carry its arguments, each padded to 32 bytes.`,
  });

  // 2. Simulation.
  const simStatus: NodeStatus =
    stage === "draft" ? "upcoming" : stage === "simulating" ? "current" : stage === "simfail" || tx.simulation?.ok === false ? "failed" : "done";
  nodes.push({
    key: "simulated", label: simStatus === "failed" ? "Would fail" : "Simulated", status: simStatus, at: entered(tx, "simulated", "simfail"),
    detail:
      tx.simulation && !tx.simulation.ok
        ? [["Result", "would revert"], ["Error", tx.simulation.error.name], ["Why", tx.simulation.error.explanation], ["Fix", tx.simulation.error.fix]]
        : tx.simulation
          ? [["Result", "would succeed"]]
          : [],
    explain: "Before anything is signed, the call is run on the node without sending it. It costs nothing, changes nothing, and tells you whether the contract would accept it.",
  });
  if (simStatus === "failed" && !tx.forced) return nodes;

  // 3. Signed / sent.
  const sentStages: FlowTx["stage"][] = ["pending", "mined", "failed", "replaced", "dropped"];
  const wasSent = tx.hash !== null || sentStages.includes(stage);
  const signedStatus: NodeStatus = stage === "rejected" || stage === "error" ? "failed" : wasSent ? "done" : stage === "signing" ? "current" : "upcoming";
  nodes.push({
    key: "signed", label: stage === "rejected" ? "Not signed" : "Signed & sent", status: signedStatus, at: entered(tx, "pending", "signing"),
    detail: tx.error && signedStatus === "failed"
      ? [["Problem", tx.error.title], ["Why", tx.error.explanation], ["Fix", tx.error.fix]]
      : [["From", tx.fromRole ? `${tx.fromRole} (${short(tx.from)})` : short(tx.from)], ["Hash", tx.hash ?? "—"], ["Nonce", tx.nonce === null ? "—" : String(tx.nonce)], ...(tx.forced ? ([["Note", "sent anyway, with a fixed gas limit"]] as [string, string][]) : [])],
    explain: "Your account signs the transaction, proving it came from you, and sends it to the node. The nonce counts your transactions so each can be used only once.",
  });
  if (signedStatus === "failed" || signedStatus === "upcoming" || signedStatus === "current") return nodes;

  // 4. Pending (mempool).
  const pendingDone = stage !== "pending";
  const pendingStage = beStage("pending");
  nodes.push({
    key: "pending", label: "Pending", status: stage === "pending" ? "current" : "done", at: pendingStage?.at ?? entered(tx, "pending"),
    detail: [["Waiting for", "a block"], ...(be ? ([["Max fee", be.maxFee ? `${be.maxFee} wei/gas` : "—"], ["Gas limit", be.gasLimit ?? "—"]] as [string, string][]) : [])],
    explain: "The node holds the transaction in its mempool until a block includes it. With automatic mining that takes an instant; in step mode it waits until you mine.",
  });
  if (stage === "pending") {
    nodes.push({ key: "mined", label: "Mined", status: "upcoming", at: null, detail: [], explain: "A block includes the transaction and the contract code runs." });
    return nodes;
  }
  void pendingDone;

  if (stage === "replaced" || stage === "dropped") {
    nodes.push({
      key: stage, label: stage === "replaced" ? "Replaced" : "Dropped", status: "failed", at: entered(tx, stage),
      detail: stage === "replaced" ? [["Replaced by", be?.replacedBy ?? "another transaction"]] : [["Result", "removed from the mempool"]],
      explain:
        stage === "replaced"
          ? "Another transaction with the same nonce was sent with a higher fee and took its place. This one never ran, so nothing was recorded."
          : "The transaction was removed from the mempool before any block included it. It never ran, so nothing was recorded.",
    });
    return nodes;
  }

  // 5. Mined, or mined-and-reverted.
  const reverted = stage === "failed";
  nodes.push({
    key: "mined", label: reverted ? "Mined (reverted)" : "Mined", status: reverted ? "failed" : "done", at: beStage("mined")?.at ?? entered(tx, "mined", "failed"),
    detail: [["Block", be?.blockNumber != null ? String(be.blockNumber) : "—"], ["Status", reverted ? "0 (reverted)" : "1 (success)"], ["Gas used", be?.gasUsed ?? "—"]],
    explain: reverted
      ? "The transaction was included in a block and the contract rejected it. Every change it made was undone, but the gas was still spent."
      : "A block included the transaction and the contract code ran successfully.",
  });

  if (reverted) {
    const why = be?.explanation ?? null;
    nodes.push({
      key: "failed", label: "Nothing recorded", status: "failed", at: entered(tx, "failed"),
      detail: why ? [["Error", why.name ?? "unknown"], ["Why", why.explanation], ["Fix", why.fix]] : [["Error", "being decoded…"]],
      explain: "A revert rolls back every change, including the ledger entry. The attempt exists on the Ethereum chain (you paid gas) but can never appear in the ledger.",
    });
    return nodes;
  }

  // 6. Recorded and verified (only for calls that write a record).
  if (tx.writesRecord) {
    const rec = beStage("recorded");
    const ver = beStage("verified");
    nodes.push({
      key: "recorded", label: "Record appended", status: rec ? "done" : "current", at: rec?.at ?? null,
      detail: rec ? [["Ledger index", rec.detail.index ?? "—"], ["hash", rec.detail.hash ?? "—"], ["prevHash", rec.detail.prevHash ?? "—"]] : [],
      explain: "The contract appended a new record to the ledger. Its prevHash is the hash of the record before it, which is what chains them together.",
    });
    const ok = ver?.detail.status === "intact";
    nodes.push({
      key: "verified", label: ver ? (ok ? "Verified" : "Verification failed") : "Verifying", status: ver ? (ok ? "done" : "failed") : rec ? "current" : "upcoming", at: ver?.at ?? null,
      detail: ver ? [["Status", ver.detail.status ?? "—"]] : [],
      explain: "The new record's hash and link are recomputed and compared with the event the contract emitted.",
    });
  }
  return nodes;
}

/** The node the user should be looking at: the failing one, else the current one, else the last. */
export function focusNode(nodes: PipelineNode[]): PipelineNode {
  return nodes.find((n) => n.status === "failed") ?? nodes.find((n) => n.status === "current") ?? nodes.at(-1)!;
}

export const isFinal = (tx: FlowTx) => FINAL_STAGES.includes(tx.stage) && !(tx.stage === "mined" && tx.writesRecord && !tx.backend?.stages.some((s) => s.key === "verified"));
