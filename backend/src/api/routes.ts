import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACTION_META, BlocksQuery, compareWithContract, explainHash, ledgerBaseSlot, makeAddressLabeler, recordSlotViews, RecordsQuery,
  TxsQuery, word, type ApiProduct, type ApiProductTrail, type ApiRecord, type ApiRecordDetail, type ApiSession,
  type ApiBalances, type ApiStorageRecord, type ApiTxDetail, type ApiVerify,
} from "@dpp/shared";
import type { Services } from "../services";
import { labAvailability } from "../lab/guard";
import { buildStages } from "../lifecycle/stages";
import { rowToRecord, rowToWitness } from "../verification";
import { blockDto, productDto, recordDto, revertDto, storageWriteDto, txDto } from "./dto";
import { badRequest, notFound } from "./errors";

const decimalParam = (name: string) => z.string().regex(/^\d+$/, `${name} must be a non-negative integer`);

export function registerLedgerRoutes(app: FastifyInstance, s: Services): void {
  // ── session ──
  app.get("/api/session", async (): Promise<ApiSession> => {
    const status = s.indexer.status();
    const deployment = s.indexer.getDeployment();

    let chainId: number | null = deployment?.chainId ?? null;
    if (chainId === null) {
      try {
        chainId = Number(BigInt(await s.rpc.send<string>("eth_chainId")));
      } catch {
        chainId = null;
      }
    }
    let automine: boolean | null = null;
    try {
      automine = await s.rpc.send<boolean>("hardhat_getAutomine");
    } catch {
      automine = null;
    }

    return {
      chainId,
      sessionId: status.sessionId as ApiSession["sessionId"],
      contracts: deployment
        ? { market: deployment.contracts.market.address, rejecter: deployment.contracts.rejecter.address }
        : null,
      deployBlock: deployment?.deployBlock ?? null,
      headBlock: status.headBlock,
      indexedBlock: status.indexedBlock,
      indexer: { state: status.state, message: status.message },
      ledgerLength: s.repo.recordCount(),
      productCount: s.repo.productCount(),
      seq: s.bus.lastSeq,
      roles: deployment?.roles ?? [],
      mining: { automine },
      lab: labAvailability(s.config, chainId),
      features: { debugTrace: s.indexer.tracing },
    };
  });

  // ── records ──
  app.get("/api/records", async (req) => {
    const q = RecordsQuery.parse(req.query);
    const rows = s.repo.listRecords({
      offset: q.offset, limit: q.limit,
      productId: q.productId !== undefined ? BigInt(q.productId) : undefined,
      actor: q.actor,
    });
    const filtered = q.productId !== undefined || q.actor !== undefined;
    const total = filtered
      ? s.repo.listRecords({ limit: 1_000_000, productId: q.productId !== undefined ? BigInt(q.productId) : undefined, actor: q.actor }).length
      : s.repo.recordCount();
    return { total, offset: q.offset, limit: q.limit, records: rows.map((r) => recordDto(s, r)) };
  });

  // ── products ──
  app.get("/api/products", async () => ({ products: s.repo.listProducts().map(productDto) }));

  app.get("/api/products/:id", async (req): Promise<ApiProduct> => {
    const { id } = z.object({ id: decimalParam("id") }).parse(req.params);
    const p = s.repo.getProduct(BigInt(id));
    if (!p) throw notFound(`Product #${id}`);
    return productDto(p);
  });

  app.get("/api/products/:id/trail", async (req): Promise<ApiProductTrail> => {
    const { id } = z.object({ id: decimalParam("id") }).parse(req.params);
    const product = s.repo.getProduct(BigInt(id));
    if (!product) throw notFound(`Product #${id}`);

    const label = makeAddressLabeler(s.indexer.getDeployment()?.roles ?? []);
    const eth = (wei: bigint) => `${Number(wei) / 1e18} ETH`;
    let owner = "";
    const steps = s.repo.listRecords({ productId: product.id, limit: 100_000 }).map((r) => {
      let note: string;
      switch (r.action) {
        case 0: owner = r.actor; note = `${label(r.actor)} registered the product and became its owner.`; break;
        case 1: note = `${label(r.actor)} listed it for ${eth(r.price)}.`; break;
        case 2: note = `${label(r.actor)} withdrew the listing.`; break;
        case 3: owner = r.counterparty; note = `${label(r.actor)} sold it to ${label(r.counterparty)} for ${eth(r.price)}.`; break;
        case 4: note = `${label(r.actor)} reserved it and deposited ${eth(r.price)} in escrow.`; break;
        case 5: note = `${label(r.actor)} ended the reservation. ${eth(r.price)} became refundable to the buyer, and the product is for sale again.`; break;
        default: note = ACTION_META[r.action as keyof typeof ACTION_META]?.summary ?? "";
      }
      return { record: recordDto(s, r) as ApiRecord, ownerAfter: owner, note };
    });
    return { product: productDto(product), steps };
  });
}

export function registerChainRoutes(app: FastifyInstance, s: Services): void {
  // ── one record in detail ──
  app.get("/api/records/:index", async (req): Promise<ApiRecordDetail> => {
    const { index } = z.object({ index: decimalParam("index") }).parse(req.params);
    const row = s.repo.getRecord(BigInt(index));
    if (!row) throw notFound(`Record #${index}`);
    const tx = row.txHash ? s.repo.getTx(row.txHash) : null;
    return {
      ...recordDto(s, row),
      hashSteps: explainHash(rowToRecord(row)),
      tx: tx ? txDto(s, tx) : null,
    };
  });

  // ── transactions ──
  app.get("/api/txs", async (req) => {
    const q = TxsQuery.parse(req.query);
    const txs = s.repo.listTxs({ state: q.state, from: q.from, limit: q.limit, offset: q.offset });
    return { total: s.repo.countTxs(q.state, q.from), txs: txs.map((t) => txDto(s, t)) };
  });

  app.get("/api/txs/:hash", async (req): Promise<ApiTxDetail> => {
    const { hash } = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "hash must be 0x followed by 64 hex characters") }).parse(req.params);
    const tx = s.repo.getTx(hash) ?? s.repo.getTx(hash.toLowerCase());
    if (!tx) throw notFound(`Transaction ${hash.slice(0, 10)}…`);

    const record = s.repo.recordForTx(tx.hash);
    const check = record ? s.verification.get().checks[Number(record.index)] : undefined;
    return {
      ...txDto(s, tx),
      stages: buildStages(tx, record, check),
      events: s.repo.eventsForTx(tx.hash).map((e) => ({ logIndex: e.logIndex, name: e.name, args: e.args })),
      storageWrites: s.repo.storageWritesForTx(tx.hash).map(storageWriteDto),
      record: record ? recordDto(s, record) : null,
      explanation: revertDto(s, tx),
    };
  });

  // ── Ethereum blocks ──
  app.get("/api/blocks", async (req) => {
    const q = BlocksQuery.parse(req.query);
    const latest = s.repo.latestBlock()?.number ?? 0;
    const to = Math.min(q.to ?? latest, latest);
    const from = Math.max(q.from ?? Math.max(0, to - 19), 0);
    if (to - from > 199) throw badRequest("Ask for at most 200 blocks at a time");
    return { blocks: s.repo.listBlocks(from, to).map((b) => blockDto(s, b)) };
  });

  // ── who has money waiting (pull payments) ──
  app.get("/api/balances", async (): Promise<ApiBalances> => {
    const deployment = s.indexer.getDeployment();
    if (!deployment) return { balances: [], contractBalance: "0" };
    const [balances, contractBalance] = await Promise.all([
      Promise.all(
        deployment.roles.map(async (r) => ({
          address: r.address,
          name: r.name,
          withdrawable: (await s.indexer.pendingWithdrawals(r.address)).toString(),
          balance: BigInt(await s.rpc.send<string>("eth_getBalance", [r.address, "latest"])).toString(),
        })),
      ),
      s.rpc.send<string>("eth_getBalance", [deployment.contracts.market.address, "latest"]).then((b) => BigInt(b).toString()),
    ]);
    return { balances, contractBalance };
  });

  // ── verification: the off-chain engine next to the contract's own check ──
  app.get("/api/verify", async (): Promise<ApiVerify> => {
    const offChain = s.verification.summary();
    const verdict = await s.indexer.onChainVerdict().catch(() => null);
    return {
      offChain,
      onChain: verdict
        ? {
            valid: verdict.valid,
            brokenAt: verdict.brokenAt.toString(),
            audit: { brokenIndexes: verdict.audit.brokenIndexes.map(String), reasons: verdict.audit.reasons },
          }
        : null,
      comparison: verdict ? compareWithContract(s.verification.get(), verdict) : null,
    };
  });

  // ── storage explorer: the 8 slots of a record, expected vs actual ──
  app.get("/api/storage/records/:index", async (req): Promise<ApiStorageRecord> => {
    const { index } = z.object({ index: decimalParam("index") }).parse(req.params);
    const row = s.repo.getRecord(BigInt(index));
    const deployment = s.indexer.getDeployment();
    if (!row || !deployment) throw notFound(`Record #${index}`);

    const address = deployment.contracts.market.address;
    const views = recordSlotViews(rowToRecord(row), deployment.storage);
    const actual = await Promise.all(
      views.map((v) => s.rpc.send<string>("eth_getStorageAt", [address, v.slotHex, "latest"]).then((x) => "0x" + x.replace(/^0x/, "").padStart(64, "0"))),
    );
    const onChain = (await s.indexer.chainRecords(Number(row.index), 1))[0] ?? null;
    const tx = row.txHash ? s.repo.getTx(row.txHash) : null;
    const slotSet = new Set(views.map((v) => v.slotHex));
    const w = rowToWitness(row);

    return {
      index: row.index.toString(),
      baseSlot: word(ledgerBaseSlot(deployment.storage)),
      slots: views.map((v, i) => ({
        position: v.position, slot: v.slotHex, expected: v.value, actual: actual[i]!,
        match: BigInt(actual[i]!) === BigInt(v.value),
        members: v.members.map((m) => ({ name: m.name, offset: m.offset, bytes: m.bytes, decoded: m.decoded })),
      })),
      abiRecord: onChain ? { hash: onChain.hash, prevHash: onChain.prevHash, price: onChain.price.toString() } : null,
      witness: w ? { productId: w.productId.toString(), action: w.action, actor: w.actor, prevHash: w.prevHash, hash: w.hash } : null,
      writtenBy: tx ? txDto(s, tx) : null,
      storageWrites: tx ? s.repo.storageWritesForTx(tx.hash).filter((x) => slotSet.has(x.slot)).map(storageWriteDto) : [],
    };
  });
}

export { badRequest, decimalParam };
