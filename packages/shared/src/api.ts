import { z } from "zod";

/**
 * The HTTP API contract. Every response is described by a zod schema; TypeScript types are inferred
 * from them, the backend's tests validate real responses against them, and the OpenAPI document is
 * generated from them. Amounts, indexes and block numbers that can exceed 2^53 are decimal strings.
 */

const decimal = z.string().regex(/^\d+$/).describe("Unsigned integer as a decimal string");
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).describe("32-byte hex value");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const ActionSchema = z.number().int().min(0).max(5).describe("0 Registered · 1 Listed · 2 Delisted · 3 Sold · 4 Reserved · 5 Revoked");
export const VerificationStatusSchema = z.enum(["intact", "dataTampered", "linkBroken", "anchorMismatch"]);
export const LifecycleStateSchema = z.enum(["pending", "mined", "failed", "replaced", "dropped"]);

// ── building blocks ──

export const RoleSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  description: z.string(),
  address,
});

export const CheckSchema = z.object({
  dataOk: z.boolean(),
  linkOk: z.boolean(),
  anchorOk: z.boolean().nullable().describe("null when no RecordAppended event was indexed"),
  status: VerificationStatusSchema.describe("Verdict including the event-log anchor"),
  onChainStatus: z.enum(["intact", "dataTampered", "linkBroken"]).describe("What the contract's own verifyLedger can see"),
  reasonMask: z.number().int().min(0).max(3).describe("1 = data mismatch, 2 = link mismatch (same as auditRange)"),
  reasons: z.array(z.string()),
  recomputedHash: hex32,
  expectedPrevHash: hex32.nullable(),
});

export const WitnessSchema = z.object({
  productId: decimal,
  action: ActionSchema,
  actor: address,
  prevHash: hex32,
  hash: hex32,
});

export const RecordSchema = z.object({
  index: decimal,
  productId: decimal,
  productName: z.string().nullable(),
  action: ActionSchema,
  actionLabel: z.string(),
  actor: address,
  counterparty: address,
  price: decimal.describe("wei"),
  timestamp: decimal,
  prevHash: hex32,
  hash: hex32,
  txHash: hex32.nullable(),
  blockNumber: z.number().int().nullable(),
  check: CheckSchema,
  witness: WitnessSchema.nullable().describe("What the RecordAppended event said when this record was written"),
});

export const RevertSchema = z.object({
  name: z.string().nullable(),
  args: z.record(z.string(), z.string()),
  data: z.string().nullable(),
  approximate: z.boolean().describe("true when recovered by replaying the call instead of tracing it"),
  title: z.string(),
  explanation: z.string(),
  fix: z.string(),
});

export const TxSchema = z.object({
  hash: hex32,
  from: address,
  to: address.nullable(),
  nonce: z.number().int(),
  value: decimal,
  functionName: z.string().nullable(),
  args: z.record(z.string(), z.string()).nullable(),
  status: z.union([z.literal(0), z.literal(1)]).nullable(),
  state: LifecycleStateSchema,
  blockNumber: z.number().int().nullable(),
  txIndex: z.number().int().nullable(),
  gasUsed: decimal.nullable(),
  gasLimit: decimal.nullable(),
  maxFee: decimal.nullable(),
  maxPriorityFee: decimal.nullable(),
  effectiveGasPrice: decimal.nullable(),
  firstSeenAt: z.number(),
  minedAt: z.number().nullable(),
  replacedBy: hex32.nullable(),
  revert: RevertSchema.nullable(),
  recordIndex: decimal.nullable(),
});

export const StageSchema = z.object({
  key: z.enum(["pending", "mined", "recorded", "verified", "failed", "explained", "replaced", "dropped"]),
  label: z.string(),
  at: z.number().nullable(),
  done: z.boolean(),
  current: z.boolean(),
  detail: z.record(z.string(), z.string().nullable()),
});

export const EventSchema = z.object({
  logIndex: z.number().int(),
  name: z.string(),
  args: z.record(z.string(), z.string()),
});

export const StorageWriteSchema = z.object({
  seq: z.number().int(),
  slot: hex32,
  before: hex32,
  after: hex32,
  gasCost: z.number().int().nullable(),
  kind: z.enum(["new", "update", "cleared", "unchanged"]),
});

export const ProductSchema = z.object({
  id: decimal,
  name: z.string(),
  owner: address,
  price: decimal,
  forSale: z.boolean(),
  reservation: z.object({ buyer: address, amount: decimal, expiresAt: decimal }).nullable(),
});

export const BlockSchema = z.object({
  number: z.number().int(),
  hash: hex32,
  parentHash: hex32,
  timestamp: z.number().int(),
  txCount: z.number().int(),
  txs: z.array(z.object({ hash: hex32, state: LifecycleStateSchema, functionName: z.string().nullable() })),
  records: z.array(decimal),
});

// ── responses ──

export const SessionSchema = z.object({
  chainId: z.number().int().nullable(),
  sessionId: hex32.nullable(),
  contracts: z.object({ market: address, rejecter: address }).nullable(),
  deployBlock: z.number().int().nullable(),
  headBlock: z.number().int().nullable(),
  indexedBlock: z.number().int().nullable(),
  indexer: z.object({ state: z.string(), message: z.string().nullable() }),
  ledgerLength: z.number().int(),
  productCount: z.number().int(),
  seq: z.number().int().describe("Latest WebSocket sequence number"),
  roles: z.array(RoleSchema),
  mining: z.object({ automine: z.boolean().nullable() }),
  lab: z.object({ available: z.boolean(), reason: z.string().nullable() }),
  features: z.object({ debugTrace: z.boolean() }),
});

export const RecordListSchema = z.object({ total: z.number().int(), offset: z.number().int(), limit: z.number().int(), records: z.array(RecordSchema) });
export const ProductListSchema = z.object({ products: z.array(ProductSchema) });
export const TxListSchema = z.object({ total: z.number().int(), txs: z.array(TxSchema) });
export const BalanceSchema = z.object({
  address,
  name: z.string().nullable().describe("Role name, when the account has one"),
  withdrawable: decimal.describe("wei the account can pull with withdraw()"),
  balance: decimal.describe("wei in the account's wallet"),
});
export const BalanceListSchema = z.object({ balances: z.array(BalanceSchema), contractBalance: decimal.describe("wei held by the market contract (escrow deposits and unclaimed funds)") });
export type ApiBalance = z.infer<typeof BalanceSchema>;
export type ApiBalances = z.infer<typeof BalanceListSchema>;

export const BlockListSchema = z.object({ blocks: z.array(BlockSchema) });

export const HashStepSchema = z.object({ name: z.string(), solidityType: z.string(), value: z.string(), word: z.string() });

export const SlotViewSchema = z.object({
  position: z.number().int(),
  slot: hex32,
  expected: hex32.describe("What the layout maths says the slot holds"),
  actual: hex32.describe("What eth_getStorageAt returns right now"),
  match: z.boolean(),
  members: z.array(z.object({ name: z.string(), offset: z.number().int(), bytes: z.number().int(), decoded: z.string() })),
});

export const RecordDetailSchema = RecordSchema.extend({
  hashSteps: z.object({ fields: z.array(HashStepSchema), encoded: z.string(), hash: hex32 }),
  tx: TxSchema.nullable(),
});

export const TxDetailSchema = TxSchema.extend({
  stages: z.array(StageSchema),
  events: z.array(EventSchema),
  storageWrites: z.array(StorageWriteSchema),
  record: RecordSchema.nullable(),
  explanation: RevertSchema.nullable(),
});

export const ProductTrailSchema = z.object({
  product: ProductSchema,
  steps: z.array(
    z.object({
      record: RecordSchema,
      ownerAfter: address,
      note: z.string(),
    }),
  ),
});

export const VerifySchema = z.object({
  offChain: z.object({
    valid: z.boolean(),
    recordCount: z.number().int(),
    firstBrokenAt: decimal.nullable(),
    firstBrokenOnChainAt: decimal.nullable(),
    brokenIndexes: z.array(decimal),
  }),
  onChain: z
    .object({
      valid: z.boolean(),
      brokenAt: decimal,
      audit: z.object({ brokenIndexes: z.array(decimal), reasons: z.array(z.number().int()) }),
    })
    .nullable(),
  comparison: z.object({ agree: z.boolean(), contractFooled: z.boolean(), notes: z.array(z.string()) }).nullable(),
});

export const StorageRecordSchema = z.object({
  index: decimal,
  baseSlot: hex32,
  slots: z.array(SlotViewSchema),
  abiRecord: z.object({ hash: hex32, prevHash: hex32, price: decimal }).nullable().describe("What getRecord(index) returns"),
  witness: WitnessSchema.nullable(),
  writtenBy: TxSchema.nullable(),
  storageWrites: z.array(StorageWriteSchema),
});

export const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

// ── inferred types ──

export type ApiSession = z.infer<typeof SessionSchema>;
export type ApiRecord = z.infer<typeof RecordSchema>;
export type ApiRecordDetail = z.infer<typeof RecordDetailSchema>;
export type ApiRecordList = z.infer<typeof RecordListSchema>;
export type ApiCheck = z.infer<typeof CheckSchema>;
export type ApiTx = z.infer<typeof TxSchema>;
export type ApiTxDetail = z.infer<typeof TxDetailSchema>;
export type ApiTxList = z.infer<typeof TxListSchema>;
export type ApiStage = z.infer<typeof StageSchema>;
export type ApiProduct = z.infer<typeof ProductSchema>;
export type ApiProductTrail = z.infer<typeof ProductTrailSchema>;
export type ApiBlock = z.infer<typeof BlockSchema>;
export type ApiVerify = z.infer<typeof VerifySchema>;
export type ApiStorageRecord = z.infer<typeof StorageRecordSchema>;
export type ApiStorageWrite = z.infer<typeof StorageWriteSchema>;
export type ApiRevert = z.infer<typeof RevertSchema>;
export type ApiError = z.infer<typeof ErrorSchema>;


// ── lab (local dev chain only) ──

export const MiningStateSchema = z.object({
  mode: z.enum(["auto", "manual", "interval"]),
  automine: z.boolean(),
  intervalMs: z.number().int().nullable(),
});
export const LabStatusSchema = z.object({ mining: MiningStateSchema, clients: z.number().int() });
export const MineResultSchema = z.object({ mined: z.number().int(), headBlock: z.number().int() });
export const TimeResultSchema = z.object({ timestamp: z.number().int() });
export const DropResultSchema = z.object({ hash: hex32, dropped: z.literal(true) });
export const ReplaceResultSchema = z.object({ original: hex32, replacement: hex32, mode: z.enum(["cancel", "speedUp"]) });

export const SnapshotSchema = z.object({ name: z.string(), id: z.string(), block: z.number().int(), createdAt: z.number() });
export const SnapshotListSchema = z.object({ snapshots: z.array(SnapshotSchema) });
export const RestoreResultSchema = z.object({ name: z.string(), headBlock: z.number().int(), snapshot: SnapshotSchema });

export const TamperWriteSchema = z.object({
  recordIndex: decimal, field: z.string(), slot: hex32, oldValue: hex32, newValue: hex32,
});
const OffChainSchema = z.object({
  valid: z.boolean(), recordCount: z.number().int(), firstBrokenAt: decimal.nullable(),
  firstBrokenOnChainAt: decimal.nullable(), brokenIndexes: z.array(decimal),
});
export const TamperResultSchema = z.object({
  groupId: z.string(),
  mode: z.enum(["data", "data+hash", "rewrite-tail", "undo"]),
  writes: z.array(TamperWriteSchema),
  changed: z.array(decimal),
  offChain: OffChainSchema,
  onChain: z.object({ valid: z.boolean(), brokenAt: decimal }).nullable(),
  comparison: z.object({ agree: z.boolean(), contractFooled: z.boolean(), notes: z.array(z.string()) }).nullable(),
});
export const TamperListSchema = z.object({
  attacks: z.array(z.object({ groupId: z.string(), mode: z.string(), createdAt: z.number(), writes: z.array(TamperWriteSchema) })),
});
export const UndoAllSchema = z.object({ undone: z.array(z.string()), offChain: OffChainSchema });

export const ScenarioInfoSchema = z.object({ name: z.string(), title: z.string(), description: z.string(), needsAutomine: z.literal(true) });
export const ScenarioListSchema = z.object({ scenarios: z.array(ScenarioInfoSchema) });
export const ScenarioRunSchema = z.object({ name: z.string(), steps: z.array(z.string()), result: z.record(z.string(), z.unknown()) });
export const ResetResultSchema = z.object({ seeded: z.boolean() });

export const TamperBody = z.object({
  index: z.union([decimal, z.number().int().min(0)]),
  field: z.enum(["index", "timestamp", "productId", "action", "actor", "counterparty", "price", "prevHash", "hash"]),
  value: z.union([z.string(), z.number()]).describe("Decimal or 0x-hex; must fit the field"),
  mode: z.enum(["data", "data+hash", "rewrite-tail"]).default("data"),
});
export type ApiLabStatus = z.infer<typeof LabStatusSchema>;
export type ApiMiningState = z.infer<typeof MiningStateSchema>;
export type ApiTamperResult = z.infer<typeof TamperResultSchema>;
export type ApiSnapshot = z.infer<typeof SnapshotSchema>;
export type ApiScenarioInfo = z.infer<typeof ScenarioInfoSchema>;

// ── route table (also drives the OpenAPI document) ──

export interface RouteSpec {
  method: "get" | "post";
  path: string;
  summary: string;
  query?: z.ZodObject<z.ZodRawShape>;
  body?: z.ZodType;
  response: z.ZodType;
  tag: "chain" | "ledger" | "transactions" | "lab";
}

const page = {
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
};

export const RecordsQuery = z.object({
  ...page,
  productId: decimal.optional(),
  actor: address.optional(),
});
export const TxsQuery = z.object({
  ...page,
  state: z.enum(["pending", "mined", "failed", "replaced", "dropped"]).optional(),
  from: address.optional(),
});
export const BlocksQuery = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
});

export const ROUTES: RouteSpec[] = [
  { method: "get", path: "/api/session", summary: "Chain, contracts, indexer state, mining mode and lab availability", response: SessionSchema, tag: "chain" },
  { method: "get", path: "/api/records", summary: "Ledger records with their verification status", query: RecordsQuery, response: RecordListSchema, tag: "ledger" },
  { method: "get", path: "/api/records/{index}", summary: "One record: hash breakdown, creating transaction, verification", response: RecordDetailSchema, tag: "ledger" },
  { method: "get", path: "/api/products", summary: "All products with their current owner, price and reservation", response: ProductListSchema, tag: "ledger" },
  { method: "get", path: "/api/products/{id}", summary: "One product", response: ProductSchema, tag: "ledger" },
  { method: "get", path: "/api/products/{id}/trail", summary: "A product's ownership timeline, including reservations and revocations", response: ProductTrailSchema, tag: "ledger" },
  { method: "get", path: "/api/txs", summary: "Transactions by lifecycle state (including failed, replaced and dropped)", query: TxsQuery, response: TxListSchema, tag: "transactions" },
  { method: "get", path: "/api/txs/{hash}", summary: "One transaction with its lifecycle stages, events and storage writes", response: TxDetailSchema, tag: "transactions" },
  { method: "get", path: "/api/blocks", summary: "Ethereum blocks with the transactions and records they contain", query: BlocksQuery, response: BlockListSchema, tag: "chain" },
  { method: "get", path: "/api/balances", summary: "Money waiting to be withdrawn, per account, and what the contract holds", response: BalanceListSchema, tag: "ledger" },
  { method: "get", path: "/api/verify", summary: "Off-chain verdict next to the contract's verifyLedger / auditRange", response: VerifySchema, tag: "ledger" },
  { method: "get", path: "/api/storage/records/{index}", summary: "Raw storage slots of a record next to their decoded values", response: StorageRecordSchema, tag: "ledger" },
  { method: "get", path: "/api/lab/status", summary: "Mining mode and number of connected clients", response: LabStatusSchema, tag: "lab" },
  { method: "post", path: "/api/lab/mining", summary: "Switch between automatic, manual and interval mining", body: z.object({ mode: z.enum(["auto", "manual", "interval"]), intervalMs: z.number().int().min(100).max(60000).optional() }), response: MiningStateSchema, tag: "lab" },
  { method: "post", path: "/api/lab/mine", summary: "Mine blocks now (manual mining)", body: z.object({ blocks: z.number().int().min(1).max(100).optional() }), response: MineResultSchema, tag: "lab" },
  { method: "post", path: "/api/lab/time", summary: "Move the chain's clock forward and mine a block", body: z.object({ seconds: z.number().int().min(1).max(2592000) }), response: TimeResultSchema, tag: "lab" },
  { method: "post", path: "/api/lab/txs/{hash}/drop", summary: "Remove a pending transaction from the mempool", response: DropResultSchema, tag: "lab" },
  { method: "post", path: "/api/lab/txs/{hash}/replace", summary: "Replace a pending transaction (cancel it or speed it up)", body: z.object({ mode: z.enum(["cancel", "speedUp"]) }), response: ReplaceResultSchema, tag: "lab" },
  { method: "get", path: "/api/lab/snapshots", summary: "Named chain snapshots", response: SnapshotListSchema, tag: "lab" },
  { method: "post", path: "/api/lab/snapshots", summary: "Take (or replace) a named snapshot", body: z.object({ name: z.string().regex(/^[\w-]{1,40}$/) }), response: SnapshotSchema, tag: "lab" },
  { method: "post", path: "/api/lab/restore", summary: "Restore the chain to a named snapshot", body: z.object({ name: z.string() }), response: RestoreResultSchema, tag: "lab" },
  { method: "get", path: "/api/lab/tamper", summary: "Active storage edits (attacks)", response: TamperListSchema, tag: "lab" },
  { method: "post", path: "/api/lab/tamper", summary: "Edit a stored record directly: data only, data + hash, or rewrite the whole tail", body: TamperBody, response: TamperResultSchema, tag: "lab" },
  { method: "post", path: "/api/lab/tamper/{groupId}/undo", summary: "Undo one attack (newest first when they overlap)", response: TamperResultSchema, tag: "lab" },
  { method: "post", path: "/api/lab/tamper/undo-all", summary: "Undo every active attack, newest first", response: UndoAllSchema, tag: "lab" },
  { method: "get", path: "/api/lab/scenarios", summary: "Scripted scenarios the lab can run", response: ScenarioListSchema, tag: "lab" },
  { method: "post", path: "/api/lab/scenarios/{name}", summary: "Run a scenario with the dev accounts", body: z.object({ count: z.number().int().min(1).max(200).optional() }), response: ScenarioRunSchema, tag: "lab" },
  { method: "post", path: "/api/lab/reset", summary: "Redeploy the contracts and optionally load the sample data", body: z.object({ seed: z.boolean().default(true), withFailures: z.boolean().default(true) }), response: ResetResultSchema, tag: "lab" },
];

// ── WebSocket protocol ──
//
// Connect to /ws, optionally with ?since=<seq>. The first message is always a `hello`. Every later
// message is a bus message { seq, type, at, data } with a strictly increasing `seq`. After a
// disconnect, reconnect with the last `seq` seen; if `hello.refetch` is true the server cannot replay
// that far back (or restarted), and the client must reload its data over REST instead.

export const WsHelloSchema = z.object({
  type: z.literal("hello"),
  seq: z.number().int().describe("Latest sequence number at connect time"),
  refetch: z.boolean().describe("true: nothing was replayed; reload everything over REST"),
  replayed: z.number().int().describe("Number of missed messages sent right after this one"),
  serverTime: z.number(),
});
export type WsHello = z.infer<typeof WsHelloSchema>;

export const WS_MESSAGE_TYPES = [
  "block.new", "tx.pending", "tx.mined", "tx.failed", "tx.replaced", "tx.dropped", "record.appended",
  "verification.changed", "chain.rewound", "chain.reset", "lab.tampered", "lab.restored", "mining.changed", "lab.scenario", "indexer.status",
] as const;
export type WsMessageType = (typeof WS_MESSAGE_TYPES)[number];

export const WsMessageSchema = z.object({
  seq: z.number().int(),
  type: z.enum(WS_MESSAGE_TYPES),
  at: z.number(),
  data: z.unknown(),
});
export type WsMessage = z.infer<typeof WsMessageSchema>;
