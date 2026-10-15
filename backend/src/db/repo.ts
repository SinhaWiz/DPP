import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type Database } from "../sqlite";
import { SCHEMA, SCHEMA_VERSION } from "./schema";
import { fromJson, toJson } from "./json";

// ───────────────────────── Row types (camelCase, in TS) ─────────────────────────

export type LifecycleState = "pending" | "mined" | "failed" | "replaced" | "dropped";

export interface BlockRow {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  txCount: number;
}

export interface TxRow {
  hash: string;
  blockNumber: number | null;
  txIndex: number | null;
  from: string;
  to: string | null;
  nonce: number;
  value: string;
  gasLimit: string | null;
  maxFee: string | null;
  maxPriorityFee: string | null;
  input: string;
  functionName: string | null;
  args: Record<string, string> | null;
  status: 0 | 1 | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  revertData: string | null;
  revertName: string | null;
  revertArgs: Record<string, string> | null;
  revertApprox: boolean;
  lifecycleState: LifecycleState;
  replacedBy: string | null;
  firstSeenAt: number;
  minedAt: number | null;
}

export interface EventRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  address: string;
  name: string;
  args: Record<string, string>;
}

export interface RecordRow {
  index: bigint;
  productId: bigint;
  action: number;
  actor: string;
  counterparty: string;
  price: bigint;
  timestamp: bigint;
  prevHash: string;
  hash: string;
  txHash: string | null;
  blockNumber: number | null;
  eventProductId: bigint | null;
  eventAction: number | null;
  eventActor: string | null;
  eventPrevHash: string | null;
  eventHash: string | null;
}

export interface ProductRow {
  id: bigint;
  name: string;
  owner: string;
  price: bigint;
  reservedBy: string | null;
  reservedAmount: bigint | null;
  reservedExpires: bigint | null;
  updatedBlock: number | null;
}

export interface StorageWriteRow {
  txHash: string;
  seq: number;
  slot: string;
  before: string;
  after: string;
  gasCost: number | null;
}

export interface TamperRow {
  id: number;
  groupId: string;
  recordIndex: bigint;
  field: string;
  slot: string;
  oldValue: string;
  newValue: string;
  mode: string;
  createdAt: number;
  undoneAt: number | null;
}

type SqlRow = Record<string, unknown>;
const big = (v: unknown): bigint | null => (v == null ? null : BigInt(v as string));

// ───────────────────────── Repository ─────────────────────────

export class Repo {
  constructor(readonly db: Database) {
    db.exec("pragma foreign_keys = on");
    db.exec(SCHEMA);
    const version = Number(this.getMeta("schema_version") ?? 0);
    if (version === 0) this.setMeta("schema_version", String(SCHEMA_VERSION));
    else if (version !== SCHEMA_VERSION) throw new Error(`Unsupported database schema version ${version}`);
  }

  /** Opens (creating if needed) a database file, or an in-memory one for ":memory:". */
  static open(path: string): Repo {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    if (path !== ":memory:") db.exec("pragma journal_mode = wal");
    db.exec("pragma synchronous = normal");
    return new Repo(db);
  }

  close(): void {
    this.db.close();
  }

  private depth = 0;

  /**
   * Runs `fn` in a transaction: all or nothing. Re-entrant: a call made inside another joins it, so
   * an error anywhere rolls back the whole outer unit of work.
   */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec("begin");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("commit");
      return result;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  // ── meta ──
  getMeta(key: string): string | null {
    const row = this.db.prepare("select value from meta where key = ?").get(key) as SqlRow | undefined;
    return (row?.value as string) ?? null;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("insert into meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  /** Forgets everything about the chain (used when the node was restarted). Keeps the schema version. */
  wipe(): void {
    this.transaction(() => {
      for (const t of ["blocks", "transactions", "events", "records", "products", "storage_writes", "tamper_journal"]) {
        this.db.exec(`delete from ${t}`);
      }
      this.db.exec("delete from meta where key <> 'schema_version'");
    });
  }

  // ── blocks ──
  upsertBlock(b: BlockRow): void {
    this.db
      .prepare(
        `insert into blocks(number, hash, parent_hash, timestamp, tx_count) values(?,?,?,?,?)
         on conflict(number) do update set hash=excluded.hash, parent_hash=excluded.parent_hash,
           timestamp=excluded.timestamp, tx_count=excluded.tx_count`,
      )
      .run(b.number, b.hash, b.parentHash, b.timestamp, b.txCount);
  }
  private blockFrom(r: SqlRow): BlockRow {
    return {
      number: r.number as number, hash: r.hash as string, parentHash: r.parent_hash as string,
      timestamp: r.timestamp as number, txCount: r.tx_count as number,
    };
  }
  getBlock(number: number): BlockRow | null {
    const r = this.db.prepare("select * from blocks where number = ?").get(number) as SqlRow | undefined;
    return r ? this.blockFrom(r) : null;
  }
  latestBlock(): BlockRow | null {
    const r = this.db.prepare("select * from blocks order by number desc limit 1").get() as SqlRow | undefined;
    return r ? this.blockFrom(r) : null;
  }
  listBlocks(from: number, to: number): BlockRow[] {
    return (this.db.prepare("select * from blocks where number between ? and ? order by number").all(from, to) as SqlRow[]).map((r) => this.blockFrom(r));
  }

  // ── transactions ──
  upsertTx(t: TxRow): void {
    this.db
      .prepare(
        `insert into transactions(hash, block_number, tx_index, from_addr, to_addr, nonce, value, gas_limit, max_fee,
           max_priority_fee, input, function_name, args_json, status, gas_used, effective_gas_price, revert_data,
           revert_name, revert_args_json, revert_approx, lifecycle_state, replaced_by, first_seen_at, mined_at)
         values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(hash) do update set block_number=excluded.block_number, tx_index=excluded.tx_index,
           function_name=excluded.function_name, args_json=excluded.args_json, status=excluded.status,
           gas_used=excluded.gas_used, effective_gas_price=excluded.effective_gas_price,
           revert_data=excluded.revert_data, revert_name=excluded.revert_name, revert_args_json=excluded.revert_args_json,
           revert_approx=excluded.revert_approx, lifecycle_state=excluded.lifecycle_state,
           replaced_by=excluded.replaced_by, first_seen_at=min(first_seen_at, excluded.first_seen_at), mined_at=excluded.mined_at`,
      )
      .run(
        t.hash, t.blockNumber, t.txIndex, t.from, t.to, t.nonce, t.value, t.gasLimit, t.maxFee, t.maxPriorityFee,
        t.input, t.functionName, t.args ? toJson(t.args) : null, t.status, t.gasUsed, t.effectiveGasPrice,
        t.revertData, t.revertName, t.revertArgs ? toJson(t.revertArgs) : null, t.revertApprox ? 1 : 0,
        t.lifecycleState, t.replacedBy, t.firstSeenAt, t.minedAt,
      );
  }
  private txFrom(r: SqlRow): TxRow {
    return {
      hash: r.hash as string, blockNumber: r.block_number as number | null, txIndex: r.tx_index as number | null,
      from: r.from_addr as string, to: r.to_addr as string | null, nonce: r.nonce as number, value: r.value as string,
      gasLimit: r.gas_limit as string | null, maxFee: r.max_fee as string | null,
      maxPriorityFee: r.max_priority_fee as string | null, input: r.input as string,
      functionName: r.function_name as string | null, args: fromJson(r.args_json as string | null),
      status: r.status as 0 | 1 | null, gasUsed: r.gas_used as string | null,
      effectiveGasPrice: r.effective_gas_price as string | null, revertData: r.revert_data as string | null,
      revertName: r.revert_name as string | null, revertArgs: fromJson(r.revert_args_json as string | null),
      revertApprox: r.revert_approx === 1, lifecycleState: r.lifecycle_state as LifecycleState,
      replacedBy: r.replaced_by as string | null, firstSeenAt: r.first_seen_at as number, minedAt: r.mined_at as number | null,
    };
  }
  getTx(hash: string): TxRow | null {
    const r = this.db.prepare("select * from transactions where hash = ?").get(hash) as SqlRow | undefined;
    return r ? this.txFrom(r) : null;
  }
  listTxs(filter: { state?: LifecycleState | LifecycleState[]; from?: string; limit?: number; offset?: number; blockNumber?: number } = {}): TxRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.state) {
      const states = Array.isArray(filter.state) ? filter.state : [filter.state];
      where.push(`lifecycle_state in (${states.map(() => "?").join(",")})`);
      args.push(...states);
    }
    if (filter.from) { where.push("lower(from_addr) = lower(?)"); args.push(filter.from); }
    if (filter.blockNumber !== undefined) { where.push("block_number = ?"); args.push(filter.blockNumber); }
    const sql = `select * from transactions ${where.length ? "where " + where.join(" and ") : ""}
                 order by coalesce(block_number, 9223372036854775807) desc, coalesce(tx_index, 0) desc, first_seen_at desc
                 limit ? offset ?`;
    return (this.db.prepare(sql).all(...args, filter.limit ?? 100, filter.offset ?? 0) as SqlRow[]).map((r) => this.txFrom(r));
  }
  /** Pending transactions from `from` with `nonce` other than `exceptHash`. Used to detect replacements. */
  findPendingBySenderNonce(from: string, nonce: number, exceptHash: string): TxRow[] {
    return (
      this.db
        .prepare("select * from transactions where lower(from_addr) = lower(?) and nonce = ? and hash <> ? and lifecycle_state = 'pending'")
        .all(from, nonce, exceptHash) as SqlRow[]
    ).map((r) => this.txFrom(r));
  }
  countTxs(state?: LifecycleState, from?: string): number {
    const where: string[] = [];
    const args: string[] = [];
    if (state) { where.push("lifecycle_state = ?"); args.push(state); }
    if (from) { where.push("lower(from_addr) = lower(?)"); args.push(from); }
    const sql = `select count(*) as n from transactions ${where.length ? "where " + where.join(" and ") : ""}`;
    return Number((this.db.prepare(sql).get(...args) as SqlRow).n);
  }

  // ── events ──
  insertEvent(e: EventRow): void {
    this.db
      .prepare(
        `insert into events(tx_hash, log_index, block_number, address, name, args_json) values(?,?,?,?,?,?)
         on conflict(tx_hash, log_index) do update set block_number=excluded.block_number, name=excluded.name, args_json=excluded.args_json`,
      )
      .run(e.txHash, e.logIndex, e.blockNumber, e.address, e.name, toJson(e.args));
  }
  private eventFrom(r: SqlRow): EventRow {
    return {
      txHash: r.tx_hash as string, logIndex: r.log_index as number, blockNumber: r.block_number as number,
      address: r.address as string, name: r.name as string, args: fromJson(r.args_json as string) ?? {},
    };
  }
  eventsForTx(txHash: string): EventRow[] {
    return (this.db.prepare("select * from events where tx_hash = ? order by log_index").all(txHash) as SqlRow[]).map((r) => this.eventFrom(r));
  }
  eventsByName(name: string, fromBlock = 0): EventRow[] {
    return (
      this.db.prepare("select * from events where name = ? and block_number >= ? order by block_number, log_index").all(name, fromBlock) as SqlRow[]
    ).map((r) => this.eventFrom(r));
  }
  /** `RecordAppended` events whose ledger index is in [from, to], keyed by that index. */
  appendedEventsByIndex(from: number, to: number): Map<number, EventRow> {
    const rows = this.db
      .prepare(
        `select * from events where name = 'RecordAppended'
           and cast(json_extract(args_json, '$.index') as integer) between ? and ?
         order by block_number, log_index`,
      )
      .all(from, to) as SqlRow[];
    const out = new Map<number, EventRow>();
    for (const r of rows) {
      const e = this.eventFrom(r);
      out.set(Number(e.args.index), e); // a later event for the same index (after a re-run) wins
    }
    return out;
  }
  eventsInBlocks(from: number, to: number): EventRow[] {
    return (this.db.prepare("select * from events where block_number between ? and ? order by block_number, log_index").all(from, to) as SqlRow[]).map((r) => this.eventFrom(r));
  }

  // ── records ──
  upsertRecord(r: RecordRow): void {
    this.db
      .prepare(
        `insert into records(idx, idx_num, product_id, action, actor, counterparty, price, timestamp, prev_hash, hash,
           tx_hash, block_number, event_product_id, event_action, event_actor, event_prev_hash, event_hash)
         values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         on conflict(idx) do update set product_id=excluded.product_id, action=excluded.action, actor=excluded.actor,
           counterparty=excluded.counterparty, price=excluded.price, timestamp=excluded.timestamp,
           prev_hash=excluded.prev_hash, hash=excluded.hash, tx_hash=excluded.tx_hash, block_number=excluded.block_number,
           event_product_id=excluded.event_product_id, event_action=excluded.event_action, event_actor=excluded.event_actor,
           event_prev_hash=excluded.event_prev_hash, event_hash=excluded.event_hash`,
      )
      .run(
        r.index.toString(), Number(r.index), r.productId.toString(), r.action, r.actor, r.counterparty, r.price.toString(),
        r.timestamp.toString(), r.prevHash, r.hash, r.txHash, r.blockNumber, r.eventProductId?.toString() ?? null,
        r.eventAction, r.eventActor, r.eventPrevHash, r.eventHash,
      );
  }
  private recordFrom(r: SqlRow): RecordRow {
    return {
      index: BigInt(r.idx as string), productId: BigInt(r.product_id as string), action: r.action as number,
      actor: r.actor as string, counterparty: r.counterparty as string, price: BigInt(r.price as string),
      timestamp: BigInt(r.timestamp as string), prevHash: r.prev_hash as string, hash: r.hash as string,
      txHash: r.tx_hash as string | null, blockNumber: r.block_number as number | null,
      eventProductId: big(r.event_product_id), eventAction: r.event_action as number | null,
      eventActor: r.event_actor as string | null, eventPrevHash: r.event_prev_hash as string | null,
      eventHash: r.event_hash as string | null,
    };
  }
  getRecord(index: bigint | number): RecordRow | null {
    const r = this.db.prepare("select * from records where idx = ?").get(index.toString()) as SqlRow | undefined;
    return r ? this.recordFrom(r) : null;
  }
  recordCount(): number {
    return Number((this.db.prepare("select count(*) as n from records").get() as SqlRow).n);
  }
  listRecords(filter: { offset?: number; limit?: number; productId?: bigint; actor?: string } = {}): RecordRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.productId !== undefined) { where.push("product_id = ?"); args.push(filter.productId.toString()); }
    if (filter.actor) { where.push("lower(actor) = lower(?)"); args.push(filter.actor); }
    const sql = `select * from records ${where.length ? "where " + where.join(" and ") : ""} order by idx_num limit ? offset ?`;
    return (this.db.prepare(sql).all(...args, filter.limit ?? 100, filter.offset ?? 0) as SqlRow[]).map((r) => this.recordFrom(r));
  }
  /** Every record in ledger order, for verification. */
  allRecords(): RecordRow[] {
    return (this.db.prepare("select * from records order by idx_num").all() as SqlRow[]).map((r) => this.recordFrom(r));
  }
  /** Drops records at `index` and above (the contract's ledger is shorter than the index thinks). */
  deleteRecordsFrom(index: number): void {
    this.db.prepare("delete from records where idx_num >= ?").run(index);
  }
  recordsForBlock(blockNumber: number): RecordRow[] {
    return (this.db.prepare("select * from records where block_number = ? order by idx_num").all(blockNumber) as SqlRow[]).map((r) => this.recordFrom(r));
  }
  recordForTx(txHash: string): RecordRow | null {
    const r = this.db.prepare("select * from records where tx_hash = ?").get(txHash) as SqlRow | undefined;
    return r ? this.recordFrom(r) : null;
  }

  // ── products ──
  upsertProduct(p: ProductRow): void {
    this.db
      .prepare(
        `insert into products(id, id_num, name, owner, price, reserved_by, reserved_amount, reserved_expires, updated_block)
         values(?,?,?,?,?,?,?,?,?)
         on conflict(id) do update set name=excluded.name, owner=excluded.owner, price=excluded.price,
           reserved_by=excluded.reserved_by, reserved_amount=excluded.reserved_amount,
           reserved_expires=excluded.reserved_expires, updated_block=excluded.updated_block`,
      )
      .run(
        p.id.toString(), Number(p.id), p.name, p.owner, p.price.toString(), p.reservedBy,
        p.reservedAmount?.toString() ?? null, p.reservedExpires?.toString() ?? null, p.updatedBlock,
      );
  }
  private productFrom(r: SqlRow): ProductRow {
    return {
      id: BigInt(r.id as string), name: r.name as string, owner: r.owner as string, price: BigInt(r.price as string),
      reservedBy: r.reserved_by as string | null, reservedAmount: big(r.reserved_amount),
      reservedExpires: big(r.reserved_expires), updatedBlock: r.updated_block as number | null,
    };
  }
  getProduct(id: bigint | number): ProductRow | null {
    const r = this.db.prepare("select * from products where id = ?").get(id.toString()) as SqlRow | undefined;
    return r ? this.productFrom(r) : null;
  }
  listProducts(): ProductRow[] {
    return (this.db.prepare("select * from products order by id_num").all() as SqlRow[]).map((r) => this.productFrom(r));
  }
  /** Drops products above `count`: after a rewind they were never registered. */
  deleteProductsAbove(count: number): void {
    this.db.prepare("delete from products where id_num > ?").run(count);
  }
  productCount(): number {
    return Number((this.db.prepare("select count(*) as n from products").get() as SqlRow).n);
  }

  // ── storage writes ──
  replaceStorageWrites(txHash: string, rows: Omit<StorageWriteRow, "txHash">[]): void {
    this.transaction(() => {
      this.db.prepare("delete from storage_writes where tx_hash = ?").run(txHash);
      const insert = this.db.prepare("insert into storage_writes(tx_hash, seq, slot, before_val, after_val, gas_cost) values(?,?,?,?,?,?)");
      for (const r of rows) insert.run(txHash, r.seq, r.slot, r.before, r.after, r.gasCost);
    });
  }
  storageWritesForTx(txHash: string): StorageWriteRow[] {
    return (this.db.prepare("select * from storage_writes where tx_hash = ? order by seq").all(txHash) as SqlRow[]).map((r) => ({
      txHash: r.tx_hash as string, seq: r.seq as number, slot: r.slot as string,
      before: r.before_val as string, after: r.after_val as string, gasCost: r.gas_cost as number | null,
    }));
  }

  // ── tamper journal ──
  addTamper(row: Omit<TamperRow, "id" | "undoneAt">): number {
    const res = this.db
      .prepare("insert into tamper_journal(group_id, record_index, field, slot, old_value, new_value, mode, created_at) values(?,?,?,?,?,?,?,?)")
      .run(row.groupId, row.recordIndex.toString(), row.field, row.slot, row.oldValue, row.newValue, row.mode, row.createdAt);
    return Number(res.lastInsertRowid);
  }
  private tamperFrom(r: SqlRow): TamperRow {
    return {
      id: r.id as number, groupId: r.group_id as string, recordIndex: BigInt(r.record_index as string),
      field: r.field as string, slot: r.slot as string, oldValue: r.old_value as string, newValue: r.new_value as string,
      mode: r.mode as string, createdAt: r.created_at as number, undoneAt: r.undone_at as number | null,
    };
  }
  tamperGroup(groupId: string): TamperRow[] {
    return (this.db.prepare("select * from tamper_journal where group_id = ? order by id").all(groupId) as SqlRow[]).map((r) => this.tamperFrom(r));
  }
  activeTamperGroups(): string[] {
    return (this.db.prepare("select group_id from tamper_journal where undone_at is null group by group_id order by min(id)").all() as SqlRow[]).map((r) => r.group_id as string);
  }
  markTamperUndone(groupId: string, at: number): void {
    this.db.prepare("update tamper_journal set undone_at = ? where group_id = ? and undone_at is null").run(at, groupId);
  }

  // ── reorg ──
  /**
   * Forgets everything that happened after block `blockNumber`: used when the chain was rewound
   * (evm_revert) and those blocks no longer exist.
   */
  rewindTo(blockNumber: number): void {
    this.transaction(() => {
      this.db.prepare("delete from storage_writes where tx_hash in (select hash from transactions where block_number > ?)").run(blockNumber);
      this.db.prepare("delete from events where block_number > ?").run(blockNumber);
      this.db.prepare("delete from records where block_number > ?").run(blockNumber);
      this.db.prepare("delete from transactions where block_number > ?").run(blockNumber);
      this.db.prepare("delete from blocks where number > ?").run(blockNumber);
    });
  }
}
