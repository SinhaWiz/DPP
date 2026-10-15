import {
  ACTION_META, explainRevert, makeAddressLabeler, type ApiBlock, type ApiCheck, type ApiProduct, type ApiRecord,
  type ApiRevert, type ApiStorageWrite, type ApiTx, type RecordCheck,
} from "@dpp/shared";
import type { BlockRow, ProductRow, RecordRow, StorageWriteRow, TxRow } from "../db/repo";
import type { Services } from "../services";
import { rowToWitness } from "../verification";

const ZERO_WORD = "0x" + "00".repeat(32);

export function checkDto(c: RecordCheck): ApiCheck {
  return {
    dataOk: c.dataOk, linkOk: c.linkOk, anchorOk: c.anchorOk, status: c.status, onChainStatus: c.onChainStatus,
    reasonMask: c.reasonMask, reasons: c.reasons, recomputedHash: c.recomputedHash, expectedPrevHash: c.expectedPrevHash,
  };
}

export function recordDto(s: Services, row: RecordRow): ApiRecord {
  const check = s.verification.get().checks[Number(row.index)];
  const w = rowToWitness(row);
  return {
    index: row.index.toString(),
    productId: row.productId.toString(),
    productName: s.repo.getProduct(row.productId)?.name ?? null,
    action: row.action,
    actionLabel: ACTION_META[row.action as keyof typeof ACTION_META]?.label ?? `Unknown(${row.action})`,
    actor: row.actor,
    counterparty: row.counterparty,
    price: row.price.toString(),
    timestamp: row.timestamp.toString(),
    prevHash: row.prevHash,
    hash: row.hash,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    check: check
      ? checkDto(check)
      : {
          dataOk: true, linkOk: true, anchorOk: null, status: "intact", onChainStatus: "intact", reasonMask: 0,
          reasons: [], recomputedHash: row.hash, expectedPrevHash: null,
        },
    witness: w
      ? { productId: w.productId.toString(), action: w.action, actor: w.actor, prevHash: w.prevHash, hash: w.hash }
      : null,
  };
}

export function revertDto(s: Services, tx: TxRow): ApiRevert | null {
  if (tx.lifecycleState !== "failed") return null;
  const labeler = s.indexer.getDeployment() ? makeAddressLabeler(s.indexer.getDeployment()!.roles) : undefined;
  if (!tx.revertData) {
    return {
      name: null, args: {}, data: null, approximate: tx.revertApprox,
      title: "Reverted without a reason",
      explanation: "The transaction was mined but reverted, and the node returned no error data. Gas was spent and nothing was recorded.",
      fix: "Check the preconditions of the function being called.",
    };
  }
  const why = explainRevert(tx.revertData, { labelAddress: labeler });
  return {
    name: why.name, args: why.args, data: tx.revertData, approximate: tx.revertApprox,
    title: why.title, explanation: why.explanation, fix: why.fix,
  };
}

export function txDto(s: Services, tx: TxRow): ApiTx {
  return {
    hash: tx.hash, from: tx.from, to: tx.to, nonce: tx.nonce, value: tx.value, functionName: tx.functionName, args: tx.args,
    status: tx.status, state: tx.lifecycleState, blockNumber: tx.blockNumber, txIndex: tx.txIndex, gasUsed: tx.gasUsed,
    gasLimit: tx.gasLimit, maxFee: tx.maxFee, maxPriorityFee: tx.maxPriorityFee, effectiveGasPrice: tx.effectiveGasPrice,
    firstSeenAt: tx.firstSeenAt, minedAt: tx.minedAt, replacedBy: tx.replacedBy, revert: revertDto(s, tx),
    recordIndex: s.repo.recordForTx(tx.hash)?.index.toString() ?? null,
  };
}

export function productDto(p: ProductRow): ApiProduct {
  return {
    id: p.id.toString(), name: p.name, owner: p.owner, price: p.price.toString(), forSale: p.price > 0n,
    reservation: p.reservedBy
      ? { buyer: p.reservedBy, amount: (p.reservedAmount ?? 0n).toString(), expiresAt: (p.reservedExpires ?? 0n).toString() }
      : null,
  };
}

export function storageWriteDto(w: StorageWriteRow): ApiStorageWrite {
  const beforeZero = BigInt(w.before) === 0n;
  const afterZero = BigInt(w.after) === 0n;
  return {
    seq: w.seq, slot: w.slot, before: w.before, after: w.after, gasCost: w.gasCost,
    kind: w.before === w.after ? "unchanged" : beforeZero ? "new" : afterZero ? "cleared" : "update",
  };
}

export function blockDto(s: Services, b: BlockRow): ApiBlock {
  return {
    number: b.number, hash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp, txCount: b.txCount,
    txs: s.repo.listTxs({ blockNumber: b.number, limit: 500 }).reverse().map((t) => ({
      hash: t.hash, state: t.lifecycleState, functionName: t.functionName,
    })),
    records: s.repo.recordsForBlock(b.number).map((r) => r.index.toString()),
  };
}

export { ZERO_WORD };
