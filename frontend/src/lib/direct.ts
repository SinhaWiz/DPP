import { Contract, JsonRpcProvider } from "ethers";
import {
  ACTION_META, marketAbi, parseDeployment, toLedgerRecord, toProduct, toReservation, verifyRecords, ZERO_ADDRESS,
  type ApiProduct, type ApiRecord, type ApiSession, type Deployment, type EventWitness, type LedgerRecord, type RecordCheck,
} from "@dpp/shared";

export interface DirectSnapshot {
  session: ApiSession;
  records: ApiRecord[];
  products: ApiProduct[];
}

/** The deployment file the dev server publishes at /deployment.json. Null if there is none. */
export async function fetchDeployment(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<Deployment | null> {
  try {
    const res = await fetchImpl("/deployment.json", { cache: "no-store" });
    if (!res.ok) return null;
    return parseDeployment(await res.json());
  } catch {
    return null;
  }
}

const PAGE = 500;
const LOG_RANGE = 5000;

function checkDto(c: RecordCheck): ApiRecord["check"] {
  return {
    dataOk: c.dataOk, linkOk: c.linkOk, anchorOk: c.anchorOk, status: c.status, onChainStatus: c.onChainStatus, reasonMask: c.reasonMask,
    reasons: c.reasons, recomputedHash: c.recomputedHash, expectedPrevHash: c.expectedPrevHash,
  };
}

/**
 * Reads the ledger straight from the node and verifies it in the browser. It has no history of
 * transactions, no mempool and no lab (those need the backend), but it shows the part that matters
 * most: whether the stored data is still what the contract announced.
 */
export async function loadDirect(rpcUrl: string, deployment: Deployment): Promise<DirectSnapshot> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const market = new Contract(deployment.contracts.market.address, marketAbi, provider);
    const call = <T>(fn: string, ...args: unknown[]) => market.getFunction(fn).staticCall(...args) as Promise<T>;

    const [network, head, length, productCount] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      call<bigint>("ledgerLength"),
      call<bigint>("productCount"),
    ]);

    // records
    const records: LedgerRecord[] = [];
    for (let offset = 0n; offset < length; offset += BigInt(PAGE)) {
      const page = await call<unknown[]>("getRecords", offset, BigInt(PAGE));
      records.push(...page.map((r) => toLedgerRecord(r as never)));
    }

    // the event log, the independent witness
    const witnesses: EventWitness[] = [];
    const logs: { blockNumber: number; index: bigint; txHash: string; w: EventWitness }[] = [];
    for (let from = deployment.deployBlock; from <= head; from += LOG_RANGE) {
      const found = await market.queryFilter(market.filters.RecordAppended!(), from, Math.min(head, from + LOG_RANGE - 1));
      for (const l of found) {
        const a = (l as unknown as { args: Record<string, unknown> }).args;
        const w: EventWitness = {
          index: a.index as bigint, productId: a.productId as bigint, action: Number(a.action) as EventWitness["action"],
          actor: a.actor as string, prevHash: a.prevHash as string, hash: a.hash as string,
        };
        witnesses.push(w);
        logs.push({ blockNumber: l.blockNumber, index: w.index, txHash: l.transactionHash, w });
      }
    }
    const verification = verifyRecords(records, { witnesses });
    const logOf = new Map(logs.map((l) => [l.index.toString(), l]));

    // products
    const products: ApiProduct[] = [];
    for (let id = 1n; id <= productCount; id++) {
      const [p, r] = await Promise.all([call<unknown>("getProduct", id), call<unknown>("getReservation", id)]);
      const prod = toProduct(p as never);
      const res = toReservation(r as never);
      products.push({
        id: prod.id.toString(), name: prod.name, owner: prod.owner, price: prod.price.toString(), forSale: prod.price > 0n,
        reservation: res.buyer === ZERO_ADDRESS ? null : { buyer: res.buyer, amount: res.amount.toString(), expiresAt: res.expiresAt.toString() },
      });
    }
    const nameOf = new Map(products.map((p) => [p.id, p.name]));

    const apiRecords: ApiRecord[] = records.map((r, i) => {
      const log = logOf.get(r.index.toString());
      return {
        index: r.index.toString(), productId: r.productId.toString(), productName: nameOf.get(r.productId.toString()) ?? null, action: r.action,
        actionLabel: ACTION_META[r.action]?.label ?? `Unknown(${r.action})`, actor: r.actor, counterparty: r.counterparty,
        price: r.price.toString(), timestamp: r.timestamp.toString(), prevHash: r.prevHash, hash: r.hash,
        txHash: log?.txHash ?? null, blockNumber: log?.blockNumber ?? null, check: checkDto(verification.checks[i]!),
        witness: log ? { productId: log.w.productId.toString(), action: log.w.action, actor: log.w.actor, prevHash: log.w.prevHash, hash: log.w.hash } : null,
      };
    });

    const session: ApiSession = {
      chainId: Number(network.chainId), sessionId: deployment.sessionId as ApiSession["sessionId"],
      contracts: { market: deployment.contracts.market.address, rejecter: deployment.contracts.rejecter.address },
      deployBlock: deployment.deployBlock, headBlock: head, indexedBlock: head,
      indexer: { state: "direct", message: "Reading straight from the node. The backend is offline." },
      ledgerLength: records.length, productCount: products.length, seq: 0, roles: deployment.roles,
      mining: { automine: null }, lab: { available: false, reason: "The lab needs the backend." }, features: { debugTrace: false },
    };
    return { session, records: apiRecords, products };
  } finally {
    provider.destroy();
  }
}
