import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACTION_META, BlocksQuery, makeAddressLabeler, RecordsQuery, TxsQuery, type ApiProduct, type ApiProductTrail, type ApiRecord,
  type ApiSession,
} from "@dpp/shared";
import type { Services } from "../services";
import { labAvailability } from "../lab/guard";
import { blockDto, productDto, recordDto, txDto } from "./dto";
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

export { badRequest, decimalParam, TxsQuery, BlocksQuery, txDto, blockDto };
