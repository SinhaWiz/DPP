/**
 * SQLite schema. Large integers (wei, hashes as numbers, indexes) are stored as decimal TEXT so
 * nothing is lost to 53-bit floats; hashes and addresses are lowercase-agnostic hex TEXT.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA = `
create table if not exists meta (
  key   text primary key,
  value text not null
);

create table if not exists blocks (
  number      integer primary key,
  hash        text not null,
  parent_hash text not null,
  timestamp   integer not null,
  tx_count    integer not null
);

create table if not exists transactions (
  hash               text primary key,
  block_number       integer,            -- null while pending / after being replaced or dropped
  tx_index           integer,
  from_addr          text not null,
  to_addr            text,
  nonce              integer not null,
  value              text not null,
  gas_limit          text,
  max_fee            text,
  max_priority_fee   text,
  input              text not null,
  function_name      text,
  args_json          text,
  status             integer,            -- 1 success, 0 reverted, null not mined
  gas_used           text,
  effective_gas_price text,
  revert_data        text,
  revert_name        text,
  revert_args_json   text,
  revert_approx      integer not null default 0,
  lifecycle_state    text not null,      -- pending | mined | failed | replaced | dropped
  replaced_by        text,
  first_seen_at      integer not null,
  mined_at           integer
);
create index if not exists idx_tx_block on transactions(block_number);
create index if not exists idx_tx_state on transactions(lifecycle_state);
create index if not exists idx_tx_sender_nonce on transactions(from_addr, nonce);

create table if not exists events (
  tx_hash      text not null,
  log_index    integer not null,
  block_number integer not null,
  address      text not null,
  name         text not null,
  args_json    text not null,
  primary key (tx_hash, log_index)
);
create index if not exists idx_events_block on events(block_number);
create index if not exists idx_events_name on events(name);

create table if not exists records (
  idx                text primary key,   -- ledger index (decimal)
  idx_num            integer not null,   -- same, for ordering
  product_id         text not null,
  action             integer not null,
  actor              text not null,
  counterparty       text not null,
  price              text not null,
  timestamp          text not null,
  prev_hash          text not null,      -- as currently stored in contract storage
  hash               text not null,
  tx_hash            text,               -- transaction that appended it (from the event)
  block_number       integer,
  event_product_id   text,               -- what the RecordAppended event said (the independent witness)
  event_action       integer,
  event_actor        text,
  event_prev_hash    text,
  event_hash         text
);
create index if not exists idx_records_num on records(idx_num);
create index if not exists idx_records_product on records(product_id);
create index if not exists idx_records_actor on records(actor);
create index if not exists idx_records_block on records(block_number);

create table if not exists products (
  id               text primary key,
  id_num           integer not null,
  name             text not null,
  owner            text not null,
  price            text not null,
  reserved_by      text,
  reserved_amount  text,
  reserved_expires text,
  updated_block    integer
);

create table if not exists storage_writes (
  tx_hash    text not null,
  seq        integer not null,
  slot       text not null,
  before_val text not null,
  after_val  text not null,
  gas_cost   integer,
  primary key (tx_hash, seq)
);

create table if not exists tamper_journal (
  id           integer primary key autoincrement,
  group_id     text not null,
  record_index text not null,
  field        text not null,
  slot         text not null,
  old_value    text not null,
  new_value    text not null,
  mode         text not null,
  created_at   integer not null,
  undone_at    integer
);
create index if not exists idx_tamper_group on tamper_journal(group_id);
`;
