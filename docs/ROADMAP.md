# Interactive Blockchain Visualizer: Implementation Roadmap

A plan for turning the Buy/Sell Traceability simulation into an interactive, educational Web3 application. The work has three tracks:

- **Smart contracts**: extensions to the Solidity code so the chain itself can express everything the UI needs to show.
- **Backend service**: an indexer, a transaction-lifecycle tracker, an API and a "lab controller" for the local dev chain.
- **Frontend**: the visualizer itself.

Together they will:

- Show every transaction **step by step**, from building it to it being mined and recorded.
- Show **failed** (reverted) and **revoked** transactions, and explain what is and isn't recorded for each.
- Show how records are **stored**: where they live in contract storage, what writing them costs, and how they are read back.
- Draw the ledger as a **chain of blocks**. Hovering a block shows its full record and transaction details.
- Animate **creating** a chain and **breaking** one, then repairing it.
- Teach as it goes: every visual has a plain-language explanation next to it.

---

## Contents

- [Part A: Analysis](#part-a-analysis)
  - [A1. Key concepts the system must get right](#a1-key-concepts-the-system-must-get-right)
  - [A2. Gap analysis: requirements vs the current code](#a2-gap-analysis-requirements-vs-the-current-code)
  - [A3. Verified facts about the Hardhat dev chain](#a3-verified-facts-about-the-hardhat-dev-chain)
  - [A4. What deliberately stays unchanged](#a4-what-deliberately-stays-unchanged)
- [Part B: Architecture](#part-b-architecture)
- [Part C: Phases](#part-c-phases)
  - [Phase 0: Decisions and monorepo setup](#phase-0-decisions-and-monorepo-setup)
  - **Smart contract track**
    - [Phase 1: Read and inspection API](#phase-1-read-and-inspection-api)
    - [Phase 2: Event enrichment](#phase-2-event-enrichment)
    - [Phase 3: Escrow purchases with revocation and pull payments](#phase-3-escrow-purchases-with-revocation-and-pull-payments)
    - [Phase 4: Dev-chain environment, deployment export and scenarios](#phase-4-dev-chain-environment-deployment-export-and-scenarios)
  - **Shared and backend track**
    - [Phase 5: Shared domain package](#phase-5-shared-domain-package)
    - [Phase 6: Backend: chain indexer](#phase-6-backend-chain-indexer)
    - [Phase 7: Backend: transaction lifecycle tracker](#phase-7-backend-transaction-lifecycle-tracker)
    - [Phase 8: Backend: REST and WebSocket API](#phase-8-backend-rest-and-websocket-api)
    - [Phase 9: Backend: lab controller](#phase-9-backend-lab-controller)
  - **Frontend track**
    - [Phase 10: Frontend scaffold](#phase-10-frontend-scaffold)
    - [Phase 11: Frontend Web3 and data layer](#phase-11-frontend-web3-and-data-layer)
    - [Phase 12: Chain visualization and hover details](#phase-12-chain-visualization-and-hover-details)
    - [Phase 13: Step-by-step transaction pipeline](#phase-13-step-by-step-transaction-pipeline)
    - [Phase 14: Failed and revoked transactions](#phase-14-failed-and-revoked-transactions)
    - [Phase 15: Storage explorer](#phase-15-storage-explorer)
    - [Phase 16: Tamper Lab](#phase-16-tamper-lab)
    - [Phase 17: Educational layer](#phase-17-educational-layer)
  - **Cross-cutting**
    - [Phase 18: Testing and quality](#phase-18-testing-and-quality)
    - [Phase 19: Documentation, polish and optional testnet](#phase-19-documentation-polish-and-optional-testnet)
- [Part D: Timeline, dependencies and risks](#part-d-timeline-dependencies-and-risks)

---

# Part A: Analysis

## A1. Key concepts the system must get right

The project has **two chains**, and no part of the system should blur them:

| | Ethereum chain (Hardhat network) | Ledger chain (inside the contract) |
|---|---|---|
| Unit | Ethereum block (contains transactions) | `Record` in `_ledger[]` |
| Link | Block header's `parentHash` | `Record.prevHash` → previous `Record.hash` |
| Created by | Mining (`evm_mine` or automine) | `_appendRecord()` during a successful transaction |
| Failed tx | Mined with `status = 0` (gas spent) | **Nothing appended.** A revert undoes all state changes |

Five facts from the current contracts shape the design:

1. **Reverted transactions leave no on-chain record.** Every guard (`EmptyName`, `NotProductOwner`, `IncorrectPayment`, …) reverts the whole call. A failed attempt exists only as a transaction with `status = 0` and its revert data. Showing failures therefore needs an **off-chain indexer** (Phase 6), not a contract change (see [A2](#a2-gap-analysis-requirements-vs-the-current-code) for why on-chain logging of failures is rejected).
2. **"Revoked" has three meanings, and the system should support all three:**
   - *Listing withdrawn*: `cancelListing()` writes a `Delisted` record. Supported today.
   - *Purchase revoked*: a buyer or seller backs out of a purchase **after money moved but before it completed**, and the money is returned. **Not possible today**, because `buy()` is atomic and instant. Phase 3 adds an escrow flow with a `Revoked` record.
   - *Transaction revoked before mining*: a pending transaction is replaced (same nonce, higher fee) or dropped. It never executes. Needs manual mining and a mempool tracker (Phases 7 and 9).
3. **On-chain verification does not cascade.** If record *i*'s data is changed, `_verify` flags record *i* because its recomputed hash differs from its stored `hash`. Record *i+1*'s `prevHash` still equals *i*'s **stored** hash, so the link looks fine. Links break only when the attacker also rewrites the stored hash. The Tamper Lab teaches this progression.
4. **Events are an independent witness.** `RecordAppended` lives in transaction logs, not contract storage, and `hardhat_setStorageAt` cannot alter it. Comparing stored hashes with event hashes catches even a full, self-consistent rewrite of the chain. Today the event carries `hash` but not `prevHash`, so only half of each link is witnessed. Phase 2 fixes that.
5. **Records are expensive to store.** Each `Record` uses 8 storage slots, plus one more for the per-product index. Appending one costs about **245,000 gas** (measured for `listForSale`). The UI can teach why real systems often keep data in events and indexers instead.

## A2. Gap analysis: requirements vs the current code

| Requirement | What exists today | Contract extension | Backend extension | Frontend |
|---|---|---|---|---|
| Visualize transactions step by step | Events per action; nothing about the tx lifecycle | — | Tx lifecycle tracker: pending → mined → decoded → record (P7). Mining-mode control (P9) | Pipeline view, mempool tray (P13) |
| Show failed transactions | Custom errors. Hardhat **throws** on reverting sends by default | — (on-chain logging rejected, see below) | Index `status = 0` txs, recover revert data with `debug_traceTransaction`, decode and persist (P6, P7). Node flag `throwOnTransactionFailures: false` (P4) | Failed-attempts tray, rejected-block animation (P14) |
| Show revoked transactions | `Delisted` only | **Escrow flow**: `reserve` / `confirmSale` / `revokeReservation` / `rejectReservation` / `expireReservation`, plus `Reserved` and `Revoked` actions and pull-payment `withdraw` (P3) | Detect replaced and dropped pending txs (P7). Drop and replace endpoints (P9) | Revocation flows and explanations (P14) |
| Storing records | Records stored; no way to see *where* or at what cost | `getRecords` bulk read (P1) | Expose storage slots and per-tx gas and SSTORE counts from traces (P6, P8) | Storage explorer (P15) |
| Hover shows transaction info | Record has no tx hash, block number or product name | `RecordAppended` gets `prevHash` and `actor` (P2) | Join record ↔ tx ↔ block ↔ product in the index (P6) | Tooltip (P12) |
| Visualize creating chains | Records link by `prevHash` | `headHash()` view (P1) | Push `record.appended` over WebSocket (P8) | Link-forming animation (P12) |
| Visualize breaking chains | `verifyLedger` / `verifyRange` return only the **first** broken index, without a reason | `inspectRecord(i)` (recomputed hash, data and link checks) and `auditRange(from, to)` (all broken indexes with reasons) (P1) | Lab controller: tamper journal, snapshot management, rewrite-tail, restore (P9). Reorg handling after `evm_revert` (P6) | Tamper Lab (P16) |
| Educative | README | NatSpec on all new functions (shown in the UI) | Scenario runner for lessons (P9) | Lessons, explanation panel, glossary (P17) |

**Rejected alternatives (and why):**

- *Log failed attempts on chain* (for example, a gateway contract that calls the market in `try/catch` and emits `AttemptRejected`). The gateway would become `msg.sender`, which breaks every ownership check. Inside the market, swallowing errors would change the meaning of every function. Failed transactions are an Ethereum-level fact and belong in the indexer.
- *Store the tx hash or block number inside `Record`.* The EVM cannot read its own transaction hash. Adding `block.number` would change the hash formula, every stored hash and the storage layout. The indexer gets both from the event log instead.
- *Make revocation delete or rewrite records.* That would contradict the append-only design. Revocation is a **new** record that reverses an earlier one, and that is the lesson.
- *Replace instant `buy()` with escrow.* Instant `buy()` stays because it demonstrates push payments and `PaymentFailed`. Escrow is added next to it so the two can be compared.

## A3. Verified facts about the Hardhat dev chain

Checked against Hardhat 2.29 in this repo. These drive several design decisions.

| Fact | Consequence |
|---|---|
| By default (`throwOnTransactionFailures: true`), sending a reverting tx with an explicit gas limit **throws** in the sender and the caller gets no tx hash | The dev node must run with `throwOnTransactionFailures: false` so a "send anyway" tx is mined with `status = 0` and returns a hash |
| Setting that flag globally makes **7 of the 25 existing tests fail** | The flag must be scoped to the dev node only (environment variable read in `hardhat.config.js`), never to `npm test` |
| `debug_traceTransaction` on a reverted tx returns `failed: true` and `returnValue` = the ABI-encoded custom error, which `interface.parseError` decodes (for example `ProductNotFound(99)`) | The indexer can explain on-chain failures exactly, even with several txs per block |
| `eth_newPendingTransactionFilter` + `eth_getFilterChanges` report pending tx hashes. `eth_getBlockByNumber("pending")` lists them | Mempool tracking works with automine off |
| `hardhat_dropTransaction` removes a pending tx. A same-nonce tx with a higher fee replaces the original (original never mined) | Both kinds of transaction-level revocation can be demonstrated |
| `evm_revert` succeeds once per snapshot id; a second revert to the same id returns `false` | The lab controller must take a fresh snapshot after every restore |
| The genesis block hash changes on every node start | Reliable signal for "node restarted, wipe the index" |
| `_ledger` is at storage slot 0 (array length), `productCount` at slot 2. Each `Record` occupies 8 slots | Tamper writes can be computed, but slots should still come from the compiler's `storageLayout` |

## A4. What deliberately stays unchanged

- The `Record` struct, the hash formula in `_computeHash`, and the meaning of `verifyLedger` / `verifyRange`. Existing hashes, the README examples and all 25 tests stay valid.
- New `Action` values are **appended** to the enum (`Reserved = 4`, `Revoked = 5`), so existing records keep their encoding.
- Instant `buy()` with push payment stays as it is.

---

# Part B: Architecture

```
┌────────────────────────────── Browser: frontend/ ──────────────────────────────┐
│  ChainView · TxPipeline · ActionPanel · StorageExplorer · TamperLab · Lessons   │
│  Zustand stores ◄── backend WebSocket (live)  ·  backend REST (history)         │
│  Signs txs itself (MetaMask or Demo accounts) ──────────────┐                  │
│  Re-verifies the chain itself with @dpp/shared verifyEngine │                  │
└───────────────┬─────────────────────────────────────────────┼──────────────────┘
                │ REST + WS (127.0.0.1:4000)                  │ JSON-RPC (signed txs, reads)
                ▼                                             │
┌──────────────────────── backend/ (Node + TypeScript) ─────┐ │
│  Indexer ── blocks, txs, receipts, traces, logs, records  │ │
│  TxLifecycle ── pending · mined · failed · replaced ·     │ │
│                 dropped                                    │ │
│  API ── REST + WebSocket                                   │ │
│  LabController ── mining mode, snapshots, tamper journal,  │ │
│                   scenarios                                │ │
│  SQLite (better-sqlite3)                                   │ │
└───────────────┬────────────────────────────────────────────┘ │
                │ JSON-RPC (reads, debug_*, evm_*, hardhat_*)   │
                ▼                                               ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ hardhat node (127.0.0.1:8545, chainId 31337, DEV_NODE=1)     │
       │ BuySellTraceability (+ escrow) · EtherRejecter               │
       └──────────────────────────────────────────────────────────────┘

      packages/shared (@dpp/shared): ABI types · hashRecipe · verifyEngine ·
      errorExplainer · storageLayout · action metadata. Used by backend and frontend.
```

**Principles**

- **The chain is the source of truth. The backend is a cache and a witness.** The frontend re-runs verification itself with the same shared code, so learners never have to trust the server's verdict.
- **Users sign their own transactions** in the browser (real Web3 flow). The backend never holds keys. Scripted scenarios use the node's unlocked dev accounts.
- **Graceful degradation.** If the backend is down, the frontend falls back to direct JSON-RPC: read-only Explorer and live verification still work. Failed-tx history, mempool and lab features are disabled with a clear notice.
- **Dev-only power is fenced off.** Lab endpoints refuse to run unless `chainId === 31337` and the server is bound to `127.0.0.1`.

| Concern | Choice | Why |
|---|---|---|
| Monorepo | **npm workspaces**: root stays the Hardhat project, plus `packages/shared`, `backend`, `frontend` | Contracts and tests don't move. One `npm install` |
| Contracts | Solidity 0.8.24, Hardhat 2.29 (existing) | |
| Web3 library | **ethers v6** (6.17 already installed) everywhere | Same API as the scripts and tests |
| Backend | **Node 20+ + TypeScript, Fastify, @fastify/websocket, better-sqlite3, zod, pino** | Small, fast, synchronous SQLite fits a single-process indexer |
| Frontend | **Vite + React 18 + TypeScript, Zustand, Framer Motion, @floating-ui/react, @tanstack/react-virtual, Tailwind** | See the frontend phases |
| Tests | Hardhat/Mocha (contracts), **Vitest** (shared, backend, frontend logic), **Playwright** (end to end) | |

Folder layout:

```
Buy_sell_simulation/
├── contracts/                     (extended in P1–P3)
├── scripts/  deploy.js (extended) · seed.js · scenarios/*.js
├── test/     existing + escrow.test.js + inspection.test.js
├── packages/shared/src/           abi.ts types.ts hashRecipe.ts verifyEngine.ts
│                                  errorExplainer.ts storageLayout.ts actions.ts
├── backend/src/
│   ├── chain/      rpc.ts session.ts
│   ├── indexer/    blockIngestor.ts txDecoder.ts traceReader.ts recordSync.ts reorg.ts
│   ├── lifecycle/  mempoolWatcher.ts txStateMachine.ts
│   ├── lab/        mining.ts snapshots.ts tamper.ts scenarios.ts guard.ts
│   ├── api/        rest/*.ts ws.ts
│   └── db/         schema.sql repo.ts
├── frontend/src/   web3/ store/ components/ pages/
└── docs/ROADMAP.md
```

---

# Part C: Phases

Each phase lists sub-steps, a deliverable or acceptance criterion, and its dependencies. Checkboxes are for tracking.

## Phase 0: Decisions and monorepo setup

- [ ] **0.1 Confirm scope**
  - [ ] 0.1.1 Local Hardhat node is the primary target. Sepolia is optional (Phase 19), and the lab, mining controls and tamper features are disabled there.
  - [ ] 0.1.2 Confirm the three meanings of "revoked" ([A1](#a1-key-concepts-the-system-must-get-right)) and that escrow is added *next to* instant `buy()`.
- [ ] **0.2 Workspaces**
  - [ ] 0.2.1 Add `"workspaces": ["packages/*", "backend", "frontend"]` to the root `package.json`.
  - [ ] 0.2.2 Create empty `packages/shared`, `backend` and `frontend` packages with TypeScript configs that extend a root `tsconfig.base.json`.
  - [ ] 0.2.3 Root scripts: `dev:node` (`DEV_NODE=1 hardhat node --hostname 127.0.0.1`), `dev:deploy`, `dev:seed`, `dev:backend`, `dev:web`, and `dev`, which runs them in order with `concurrently` and `wait-on`.
  - [ ] 0.2.4 Extend `.gitignore`: `**/dist/`, `backend/data/*.sqlite*`, `playwright-report/`, `test-results/`, `packages/shared/src/generated/`.
- [ ] **0.3 Design language** (agreed before building components)
  - [ ] 0.3.1 Colour per action: Registered = blue, Listed = amber, Delisted = grey, Reserved = violet, Revoked = orange, Sold = green.
  - [ ] 0.3.2 Colour per status: intact = green, data-hash mismatch = red, broken link = red dashed, event mismatch = purple, pending = pulsing outline, failed = red ✕, replaced or dropped = struck-through grey.
  - [ ] 0.3.3 Every colour also gets an icon or label, so nothing depends on colour alone.

**Deliverable:** workspaces install with one `npm install`. `npm test` still passes.

---

## Phase 1: Read and inspection API

**Goal:** let the backend and UI read the ledger in bulk and get the reason a record is broken, not just "broken at *i*".

- [ ] **1.1 Bulk reads** (`ITraceabilityLedger`, `HashChainLedger`)
  - [ ] 1.1.1 `getRecords(uint256 offset, uint256 limit) returns (Record[] memory)`, using the same clamping as `_historyPage`.
  - [ ] 1.1.2 `headHash() returns (bytes32)`, a public wrapper over `_headHash()`.
  - [ ] 1.1.3 `getProducts(uint256 offset, uint256 limit) returns (Product[] memory)` in `BuySellTraceability` (ids start at 1).
- [ ] **1.2 Inspection** (`HashChainLedger`)
  - [ ] 1.2.1 Add the struct `RecordInspection { Record record; bytes32 recomputedHash; bytes32 expectedPrevHash; bool dataOk; bool linkOk; }` to the interface.
  - [ ] 1.2.2 `inspectRecord(uint256 index) returns (RecordInspection memory)`, reusing `_computeHash` and the same expected-prev logic as `_verify`.
  - [ ] 1.2.3 `auditRange(uint256 fromIndex, uint256 toIndex) returns (uint256[] memory brokenIndexes, uint8[] memory reasons)`, where reason is a bitmask: 1 = data mismatch, 2 = link mismatch. Same range validation as `verifyRange`. NatSpec recommends ranges of at most 500 to stay inside the `eth_call` gas cap.
  - [ ] 1.2.4 Refactor `_verify` and `auditRange` to share one private per-record check, so the two can never disagree.
- [ ] **1.3 Tests** (`test/inspection.test.js`)
  - [ ] 1.3.1 `getRecords`: window, clamped last page, empty page for out-of-range offset, huge limit.
  - [ ] 1.3.2 `getProducts`: same cases. `headHash` is `0x00…00` on an empty ledger, then equals the last record's hash.
  - [ ] 1.3.3 `inspectRecord` and `auditRange` on a clean chain; after a data tamper (reason 1 at *i*); after a data+hash tamper (reason 1 cleared at *i*, reason 2 at *i+1*); after two separate tampers (both reported, unlike `verifyLedger`).
  - [ ] 1.3.4 Move the existing `tamperWithPrice` / `findLedgerSlot` helpers into `test/helpers/tamper.js` and add `tamperWithHash` for reuse.
- [ ] **1.4 Docs**
  - [ ] 1.4.1 README: read-API table and a "Why verifyLedger reports only the first break" note.

**Acceptance:** new tests pass, the existing 25 tests are unchanged and passing, and the contract still compiles with the optimizer settings.

---

## Phase 2: Event enrichment

**Goal:** make the event log a complete, independent witness of every link, and give indexers everything they need without extra storage reads.

- [ ] **2.1 Change `RecordAppended`**
  - [ ] 2.1.1 New signature: `RecordAppended(uint256 indexed index, uint256 indexed productId, Action action, address indexed actor, bytes32 prevHash, bytes32 hash)`.
  - [ ] 2.1.2 Emit it from `_appendRecord`. Gas rises by a few hundred per record. Note this in the README.
  - [ ] 2.1.3 With `actor` indexed, "all records by this account" becomes a log filter (used by the hover card's "other activity" link).
- [ ] **2.2 Tests**
  - [ ] 2.2.1 `expect(tx).to.emit(c, "RecordAppended").withArgs(...)` for each action, including `prevHash` linking to the previous event's `hash`.
  - [ ] 2.2.2 After `tamperWithHash`, the event-log chain is still intact while storage is not (the basis of the anchor check).
- [ ] **2.3 Docs**
  - [ ] 2.3.1 README §5: "Two witnesses: storage and logs".

**Acceptance:** rebuilding the full chain from logs alone gives the same `prevHash`/`hash` sequence as `getRecords`.

---

## Phase 3: Escrow purchases with revocation and pull payments

**Goal:** add a purchase that can be **revoked after money moved**, with every step recorded, so learners see a reversal appended instead of history being erased. Also shows the pull-payment pattern next to the existing push payment.

- [ ] **3.1 Types and state**
  - [ ] 3.1.1 Append to `Action`: `Reserved` (buyer deposited payment, product locked) and `Revoked` (reservation cancelled, payment returned).
  - [ ] 3.1.2 Add `struct Reservation { address buyer; uint256 amount; uint64 expiresAt; }` and `mapping(uint256 productId => Reservation) _reservations`.
  - [ ] 3.1.3 Add `mapping(address => uint256) pendingWithdrawals` and a constant `RESERVATION_PERIOD = 1 days`.
  - [ ] 3.1.4 New errors: `ProductReserved(id)`, `NotReserved(id)`, `NotReservationBuyer(id, caller)`, `ReservationExpired(id, expiredAt)` (seller confirming too late), `ReservationNotExpired(id, expiresAt)`, `NothingToWithdraw(account)`, `WithdrawFailed(account)`.
  - [ ] 3.1.5 New events: `ReservationCreated(id, buyer, amount, expiresAt)` (not `ProductReserved`: a Solidity event and error cannot share a name), `ReservationRevoked(id, by, buyer, amount, reason)` where reason is `BuyerCancelled | SellerRejected | Expired`, `SaleConfirmed(id, seller, buyer, amount)`, and `Withdrawn(account, amount)`.
- [ ] **3.2 Functions** (all follow checks-effects-interactions)
  - [ ] 3.2.1 `reserve(id) payable`: listed, not own product, exact price, not already reserved. Stores the reservation and appends `Reserved` (actor = buyer, counterparty = seller, price = amount). The listing stays, but is locked.
  - [ ] 3.2.2 `confirmSale(id)` (seller, before expiry): transfers ownership, clears the listing and reservation, credits `pendingWithdrawals[seller]`, and appends `Sold` (actor = seller, counterparty = buyer). The trail reads the same as an instant sale.
  - [ ] 3.2.3 `revokeReservation(id)` (buyer, before confirmation): clears the reservation, credits the refund to `pendingWithdrawals[buyer]`, and appends `Revoked` (actor = buyer, counterparty = seller, price = amount).
  - [ ] 3.2.4 `rejectReservation(id)` (seller): same as 3.2.3 but actor = seller.
  - [ ] 3.2.5 `expireReservation(id)` (anyone, once `block.timestamp > expiresAt`): same refund, appends `Revoked` with actor = caller. Teaches time on chain together with `evm_increaseTime` (Phase 9).
  - [ ] 3.2.6 `withdraw()`: pays `pendingWithdrawals[msg.sender]`, zeroing it first. Not a ledger record, because it moves money rather than changing a product.
  - [ ] 3.2.7 Lock existing paths: `listForSale`, `cancelListing` and `buy` revert with `ProductReserved` while a reservation exists.
  - [ ] 3.2.8 Views: `getReservation(id)`, `isReserved(id)`.
- [ ] **3.3 Tests** (`test/escrow.test.js`)
  - [ ] 3.3.1 Happy path: reserve → confirm → withdraw. Balances, ownership, and trail `[Registered, Listed, Reserved, Sold]`.
  - [ ] 3.3.2 Each revocation path (buyer, seller, expiry), including refunds through `withdraw` and the `Revoked` record's actor.
  - [ ] 3.3.3 Every new error, and the locks on `listForSale`, `cancelListing` and `buy`.
  - [ ] 3.3.4 `EtherRejecter` as seller: escrow + `withdraw` fails only for the rejecter itself, while the sale still completes. Contrast with `PaymentFailed` reverting the whole instant `buy()`.
  - [ ] 3.3.5 Hash chain stays valid across all new actions, and the off-chain hash recipe still matches (enum values 4 and 5 encode as `uint8`).
  - [ ] 3.3.6 Reentrancy: a malicious withdrawer contract can't withdraw twice.
- [ ] **3.4 Docs**
  - [ ] 3.4.1 README: escrow workflow diagram, push vs pull payments, and the updated "Design decisions and limitations" (the pull-payment limitation is now addressed for escrow).

**Acceptance:** all old and new tests pass. Contract size stays well under 24 KB. Gas report for each new function is recorded in the README.

---

## Phase 4: Dev-chain environment, deployment export and scenarios

**Goal:** a reproducible local chain that the backend and frontend can rely on.

- [ ] **4.1 `hardhat.config.js`**
  - [ ] 4.1.1 `networks.hardhat.chainId = 31337` explicitly.
  - [ ] 4.1.2 When `process.env.DEV_NODE === "1"`: `throwOnTransactionFailures: false` (verified necessary, see [A3](#a3-verified-facts-about-the-hardhat-dev-chain)) and `mining: { auto: true, interval: 0 }`. Leave defaults otherwise, so `npm test` keeps its current behaviour.
  - [ ] 4.1.3 Add `"storageLayout"` to `outputSelection` so slots are known exactly.
  - [ ] 4.1.4 `networks.localhost.url = "http://127.0.0.1:8545"`.
- [ ] **4.2 Deployment export** (`scripts/deploy.js`)
  - [ ] 4.2.1 Deploy `BuySellTraceability` and an `EtherRejecter` (demonstrates `PaymentFailed` and failed withdrawals).
  - [ ] 4.2.2 Generate `packages/shared/src/generated/deployment.json` with: `chainId`, genesis block hash (session id), addresses, ABIs, `deployBlock`, and the storage layout of `_ledger`, `_products` and `_reservations` from the build info.
  - [ ] 4.2.3 Refuse to run on an unexpected chain id. Print the next steps.
- [ ] **4.3 Roles** (`scripts/roles.json`, copied into shared)
  - [ ] 4.3.1 Hardhat accounts #0–#4 → Manufacturer, Distributor, Retailer, Customer, Outsider. The EtherRejecter is "Broken Wallet".
- [ ] **4.4 Seed and scenarios** (`scripts/seed.js`, `scripts/scenarios/*.js`)
  - [ ] 4.4.1 `seed`: the Manufacturer → Distributor → Retailer → Customer laptop story (from `simulate.js`), plus a phone with list → delist → relist → reserve → revoke → reserve → confirm.
  - [ ] 4.4.2 `--with-failures`: send a few reverting txs with an explicit gas limit, so failures exist from the start.
  - [ ] 4.4.3 Scenarios as importable functions (used by the lab controller and lessons): `supplyChain`, `everyError`, `escrowRevocations`, `pendingReplacement`, `bulk(n)` for performance tests.
  - [ ] 4.4.4 Write a hash fixture (`packages/shared/test/fixtures/records.json`) for parity tests.

**Acceptance:** `npm run dev:node`, `dev:deploy` and `dev:seed` give a populated chain with successful, failed and revoked activity, plus a valid `deployment.json`. `npm test` behaviour is unchanged.

---

## Phase 5: Shared domain package

**Goal:** one implementation of the domain logic, used by both backend and frontend, so they can't drift apart.

- [ ] **5.1 Types and ABI** (`types.ts`, `abi.ts`)
  - [ ] 5.1.1 `Record`, `Product`, `Reservation`, `Action` (with labels, colours, icons and one-line explanations in `actions.ts`), all using `bigint`.
  - [ ] 5.1.2 Typed `Interface` objects built from the generated ABI.
- [ ] **5.2 Hash recipe** (`hashRecipe.ts`)
  - [ ] 5.2.1 Exact port of `_computeHash`:
    ```ts
    keccak256(AbiCoder.defaultAbiCoder().encode(
      ["uint256","uint256","uint256","uint8","address","address","uint256","bytes32"],
      [r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash]))
    ```
  - [ ] 5.2.2 `explainHash(record)` returns each field's 32-byte word, the concatenated encoding and the result, for the step-through UI.
- [ ] **5.3 Verification engine** (`verifyEngine.ts`)
  - [ ] 5.3.1 For each record:
    - `dataOk`: recomputed hash === stored `hash`
    - `linkOk`: stored `prevHash` === previous stored `hash` (`0x00…00` for #0)
    - `anchorOk`: stored `prevHash` and `hash` === values in that index's `RecordAppended` event
  - [ ] 5.3.2 Status: `intact | dataTampered | linkBroken | anchorMismatch`, plus `firstBrokenAt` and the full list of broken records.
  - [ ] 5.3.3 Incremental mode: re-verify from index *k* onward.
- [ ] **5.4 Error explainer** (`errorExplainer.ts`)
  - [ ] 5.4.1 Decode revert data with `Interface.parseError`.
  - [ ] 5.4.2 Plain-English explanation and "how to fix" hint for each error:

    | Error | Explanation |
    |---|---|
    | `EmptyName` | Products need a name. |
    | `InvalidPrice` | A listing price must be above 0 wei. |
    | `ProductNotFound(id)` | Product #id was never registered. |
    | `NotProductOwner(id, caller)` | Only the current owner may do this, and *caller* isn't the owner. |
    | `NotListed(id)` | The product isn't for sale. |
    | `CannotBuyOwnProduct(id)` | Seller and buyer are the same account. |
    | `IncorrectPayment(expected, sent)` | The exact price must be sent: expected *X*, sent *Y*. |
    | `PaymentFailed(recipient)` | The seller can't receive ETH, so the whole sale was rolled back. |
    | `ProductReserved(id)` | Another buyer has reserved this product. It's locked until confirmed or revoked. |
    | `NotReserved(id)` | There is no reservation to confirm or revoke. |
    | `NotReservationBuyer(id, caller)` | Only the buyer who reserved can revoke. |
    | `ReservationExpired(id, at)` | The reservation period ended at *at*, so the seller can no longer confirm. |
    | `ReservationNotExpired(id, at)` | Anyone can expire a reservation, but only after *at*. |
    | `NothingToWithdraw(account)` | No funds waiting for this account. |
    | `WithdrawFailed(account)` | This account is a contract that refuses ETH. Its funds stay safe in the contract. |

  - [ ] 5.4.3 Fallbacks: user rejected, insufficient funds, nonce too low/high, gas limit too low.
- [ ] **5.5 Storage layout** (`storageLayout.ts`)
  - [ ] 5.5.1 Slot maths from `deployment.json`. `_ledger[i]` base = `keccak256(slot) + 8·i`. Field offsets: `0 index · 1 timestamp · 2 productId · 3 action(uint8)+actor(address) packed · 4 counterparty · 5 price · 6 prevHash · 7 hash`.
  - [ ] 5.5.2 Encode and decode helpers for each field. The packed slot 3 helper preserves the bits it doesn't change.
- [ ] **5.6 Tests (Vitest)**
  - [ ] 5.6.1 Hash parity with the fixture from 4.4.4.
  - [ ] 5.6.2 Verification engine with clean, data-tampered, data+hash-tampered and full-tail-rewrite inputs.
  - [ ] 5.6.3 Error decoding for every error, using encoded samples.
  - [ ] 5.6.4 Slot maths, including the packed slot.

**Acceptance:** `npm test -w packages/shared` passes, and it builds to ESM consumable by Vite and Node.

---

## Phase 6: Backend: chain indexer

**Goal:** a durable, queryable copy of everything that happened, including what the contract itself can't store.

- [ ] **6.1 Scaffold** (`backend/`)
  - [ ] 6.1.1 Fastify app, pino logger, zod-validated config (`RPC_URL`, `PORT=4000`, `HOST=127.0.0.1`, `DB_PATH`).
  - [ ] 6.1.2 `chain/rpc.ts`: `JsonRpcProvider` with retry/backoff, plus a raw `send` for `debug_*`, `evm_*` and `hardhat_*`.
- [ ] **6.2 Database** (`db/schema.sql`, SQLite in WAL mode)
  - [ ] 6.2.1 `sessions(id = genesis hash, chain_id, contract_address, deploy_block, started_at)`.
  - [ ] 6.2.2 `blocks(number, hash, parent_hash, timestamp, tx_count, session_id)`.
  - [ ] 6.2.3 `transactions(hash, from, to, nonce, value, function, args_json, status, gas_used, block_number, revert_selector, revert_name, revert_args_json, lifecycle_state, replaced_by, first_seen_at, mined_at)`.
  - [ ] 6.2.4 `events(tx_hash, log_index, block_number, name, args_json)`.
  - [ ] 6.2.5 `records(index, product_id, action, actor, counterparty, price, timestamp, prev_hash, hash, tx_hash, block_number, event_prev_hash, event_hash)`. A copy of the event values is stored alongside the storage values.
  - [ ] 6.2.6 `products(id, name, owner, price, reserved_by, updated_block)` and `storage_writes(tx_hash, slot, before, after)` (from traces, for the Storage explorer).
  - [ ] 6.2.7 `tamper_journal(...)` (used in Phase 9).
- [ ] **6.3 Session management** (`chain/session.ts`)
  - [ ] 6.3.1 On start and every 5 s, read block 0's hash. If it differs from the stored session, start a new session (archive or wipe old rows) and broadcast `chain.reset`.
  - [ ] 6.3.2 If the contract code is missing at the configured address, enter a "waiting for deploy" state and reload `deployment.json` when it changes.
- [ ] **6.4 Block ingestion** (`indexer/blockIngestor.ts`)
  - [ ] 6.4.1 Backfill from `deployBlock` to head, then follow new blocks (poll `eth_blockNumber` every 500 ms. A Hardhat node also supports `eth_subscribe` over WebSocket, so use it when available).
  - [ ] 6.4.2 For each block, fetch it with full txs and keep only txs to the contract addresses (plus value transfers between role accounts, for replacement detection).
- [ ] **6.5 Transaction decoding** (`indexer/txDecoder.ts`, `indexer/traceReader.ts`)
  - [ ] 6.5.1 Decode calldata with `Interface.parseTransaction` into function name and args.
  - [ ] 6.5.2 Receipt: status, gas used, logs. Decode logs into `events`.
  - [ ] 6.5.3 If `status = 0`: call `debug_traceTransaction(hash, { disableStack, disableMemory, disableStorage })`, take `returnValue` and decode it with the error explainer. If tracing is unavailable, re-run `eth_call` at the parent block as an approximation and flag the result as approximate.
  - [ ] 6.5.4 If `status = 1` (optional detail): trace with storage enabled to extract `SSTORE` slots, before/after values, and the gas spent on storage. Store this in `storage_writes`.
- [ ] **6.6 Record sync** (`indexer/recordSync.ts`)
  - [ ] 6.6.1 For each `RecordAppended`, read the record from storage (`getRecords` in pages of 50 during backfill) and store both the storage and event values.
  - [ ] 6.6.2 Refresh affected `products` rows on product events.
  - [ ] 6.6.3 Run the shared verification engine incrementally and cache the result.
- [ ] **6.7 Reorg handling** (`indexer/reorg.ts`)
  - [ ] 6.7.1 `evm_revert` rewinds blocks, so check each new block's `parent_hash` against the stored block at `number - 1`.
  - [ ] 6.7.2 On mismatch, walk back to the common ancestor, delete rows above it, re-ingest, and broadcast `chain.rewound { toBlock }`.
- [ ] **6.8 Storage re-scan**
  - [ ] 6.8.1 `rescanStorage(from, to)` re-reads records from contract storage without new blocks. Tampering changes storage without mining, so the lab controller calls this after each tamper.

**Acceptance:** after `dev:seed --with-failures`, the DB contains every record, every failed tx with a decoded error, and every block. Killing and restarting the backend resumes without duplicates. Restarting the node triggers a new session.

---

## Phase 7: Backend: transaction lifecycle tracker

**Goal:** know where every transaction is at every moment, including those that never make it.

- [ ] **7.1 State machine** (`lifecycle/txStateMachine.ts`)
  - [ ] 7.1.1 States and transitions:
    ```
    Pending ─► Mined(success) ─► Recorded (RecordAppended seen) ─► Verified
       │   └─► Mined(reverted) ─► Explained (revert decoded)
       ├─► Replaced (another tx with the same from+nonce was mined)
       └─► Dropped  (removed from the pool, nonce never used by it)
    ```
  - [ ] 7.1.2 Each transition stores a timestamp and is broadcast over WebSocket.
  - [ ] 7.1.3 The frontend adds the browser-only stages before these: Draft → Simulated → Signed (Phase 13).
- [ ] **7.2 Mempool watcher** (`lifecycle/mempoolWatcher.ts`)
  - [ ] 7.2.1 `eth_newPendingTransactionFilter`, polled with `eth_getFilterChanges` every 300 ms (verified on Hardhat).
  - [ ] 7.2.2 Fetch each pending tx (`eth_getTransactionByHash`), decode it, and insert it as `Pending` with `first_seen_at`.
  - [ ] 7.2.3 Re-create the filter after a session reset or `evm_revert`.
- [ ] **7.3 Replacement and drop detection**
  - [ ] 7.3.1 On each mined tx, look up pending txs with the same `from` and `nonce` but a different hash, and mark them `Replaced` with `replaced_by`.
  - [ ] 7.3.2 Mark `Dropped` when the lab drops a tx (Phase 9), or when a pending tx disappears from `eth_getBlockByNumber("pending")` without being mined or replaced.
- [ ] **7.4 Tests (Vitest against an in-process Hardhat node)**
  - [ ] 7.4.1 Automine success, mined revert, manual-mining pending → mined, replacement, drop. Each ends in the expected state with the expected broadcasts.

**Acceptance:** every scenario in 4.4.3 produces the correct final state for every tx.

---

## Phase 8: Backend: REST and WebSocket API

**Goal:** a small, documented API that serves everything the frontend shows.

- [ ] **8.1 REST** (zod-validated, JSON with `bigint` serialized as strings)
  - [ ] 8.1.1 `GET /api/session`: chain id, session id, contract addresses, head block, mining mode, lab availability.
  - [ ] 8.1.2 `GET /api/records?offset&limit&productId&actor`: records with their tx, block and verification status.
  - [ ] 8.1.3 `GET /api/records/:index`: full detail including the `explainHash` breakdown, storage slots for every field, the creating tx, gas and storage writes.
  - [ ] 8.1.4 `GET /api/products`, `GET /api/products/:id`, `GET /api/products/:id/trail` (ownership timeline, reservations, revocations).
  - [ ] 8.1.5 `GET /api/txs?state=failed|replaced|dropped|pending|mined&from&limit` and `GET /api/txs/:hash` (all lifecycle stages with timestamps).
  - [ ] 8.1.6 `GET /api/blocks?from&to`: Ethereum blocks with the records they produced.
  - [ ] 8.1.7 `GET /api/verify`: the off-chain engine's verdict, plus the on-chain `verifyLedger()` and `auditRange()` results side by side.
  - [ ] 8.1.8 `GET /api/storage/records/:index`: raw slot values next to the decoded values (Storage explorer).
- [ ] **8.2 WebSocket** (`/ws`)
  - [ ] 8.2.1 Messages: `block.new`, `tx.pending`, `tx.mined`, `tx.failed`, `tx.replaced`, `tx.dropped`, `record.appended`, `verification.changed`, `chain.rewound`, `chain.reset`, `lab.tampered`, `lab.restored`, `mining.changed`.
  - [ ] 8.2.2 Each message has a sequence number. Clients resume with `?since=<seq>` after reconnecting, and anything older than the buffer triggers a full refetch.
- [ ] **8.3 Contract**
  - [ ] 8.3.1 Generate an OpenAPI spec from the zod schemas and export TypeScript client types into `packages/shared` for the frontend.
  - [ ] 8.3.2 CORS allows only the Vite dev origin.
- [ ] **8.4 Tests**
  - [ ] 8.4.1 Route tests with Fastify `inject` against a seeded DB. WebSocket test for ordering and resume.

**Acceptance:** the frontend can render every screen from the API alone, and the OpenAPI spec is generated in CI.

---

## Phase 9: Backend: lab controller

**Goal:** safe, recorded, reversible control over the dev chain for step mode, revocation demos, tampering and lessons.

- [ ] **9.1 Guard** (`lab/guard.ts`)
  - [ ] 9.1.1 Every `/api/lab/*` route checks `chainId === 31337`, that the server is bound to `127.0.0.1`, and that the session is active. Otherwise it returns 403 with an explanation.
- [ ] **9.2 Mining and time** (`lab/mining.ts`)
  - [ ] 9.2.1 `POST /api/lab/mining { mode: "auto" | "manual" | "interval", intervalMs? }` → `evm_setAutomine` / `evm_setIntervalMining`.
  - [ ] 9.2.2 `POST /api/lab/mine { blocks?: n }` → `evm_mine`.
  - [ ] 9.2.3 `POST /api/lab/time { increaseSeconds }` → `evm_increaseTime` + `evm_mine` (for `expireReservation`).
  - [ ] 9.2.4 When the last WebSocket client disconnects, return to automine so MetaMask txs don't hang.
- [ ] **9.3 Pending transaction control**
  - [ ] 9.3.1 `POST /api/lab/txs/:hash/drop` → `hardhat_dropTransaction`, then mark it `Dropped`.
  - [ ] 9.3.2 Replacement is signed by the user in the browser (same nonce, higher fee), and the tracker detects it (7.3.1). For scripted lessons, `POST /api/lab/txs/:hash/replace` uses the node's unlocked account.
- [ ] **9.4 Snapshots** (`lab/snapshots.ts`)
  - [ ] 9.4.1 Named snapshots (`lab-entry`, `lesson-3-start`, …) mapped to `evm_snapshot` ids.
  - [ ] 9.4.2 `POST /api/lab/restore { name }` → `evm_revert`, then immediately re-snapshot under the same name (ids are single-use, verified), then trigger the indexer's rewind (6.7).
- [ ] **9.5 Tamper engine** (`lab/tamper.ts`)
  - [ ] 9.5.1 `POST /api/lab/tamper { index, field, value, mode }` with these modes:
    - `data`: write the field only
    - `data+hash`: write the field and the correct recomputed hash into slot 7
    - `rewrite-tail`: also recompute `prevHash` and `hash` for every later record
  - [ ] 9.5.2 Before each write, read the old slot value into `tamper_journal(id, group_id, record_index, field, slot, old_value, new_value, created_at, undone_at)`.
  - [ ] 9.5.3 `POST /api/lab/tamper/:groupId/undo` writes the old values back in reverse order. This is finer-grained than a snapshot restore, so one attack can be undone while others stay.
  - [ ] 9.5.4 After every write or undo, call `rescanStorage` (6.8) and broadcast `lab.tampered` with before/after values and the new verdicts.
- [ ] **9.6 Scenarios and reset** (`lab/scenarios.ts`)
  - [ ] 9.6.1 `POST /api/lab/scenarios/:name` runs a scenario from 4.4.3 with the node's dev accounts and streams progress over WebSocket.
  - [ ] 9.6.2 `POST /api/lab/reset` redeploys, re-seeds, regenerates `deployment.json` and starts a new session (for lessons that need a clean chain).
- [ ] **9.7 Tests**
  - [ ] 9.7.1 Each tamper mode gives the predicted on-chain verdicts (`verifyLedger`, `auditRange`) and off-chain verdicts. Undo restores `intact`. Restore twice in a row works. Guard rejects a non-31337 chain.

**Acceptance:** every lab action is reversible, journaled and reflected in the index within one second.

---

## Phase 10: Frontend scaffold

- [ ] **10.1 Create the app**
  - [ ] 10.1.1 Vite React-TS template in `frontend/`, using the `@dpp/shared` workspace dependency.
  - [ ] 10.1.2 Install `ethers@6`, `zustand`, `framer-motion`, `@floating-ui/react`, `@tanstack/react-virtual`, `tailwindcss`, `react-router-dom`.
- [ ] **10.2 Layout**
  - [ ] 10.2.1 Top bar: network badge (chain id, block), backend status, account switcher, mining-mode control.
  - [ ] 10.2.2 Centre: chain strip. Left drawer: action panel. Right drawer: explanation panel. Bottom dock: pipeline, mempool and activity.
- [ ] **10.3 Routes**
  - [ ] 10.3.1 `/` Explorer, `/playground`, `/storage`, `/tamper` (local only), `/learn`.
- [ ] **10.4 Primitives**
  - [ ] 10.4.1 `<Address>`, `<Hash>`, `<Eth>`, `<ActionBadge>`, `<StatusPill>`, `<SlotValue>`.
  - [ ] 10.4.2 Light and dark themes from the design tokens.

**Acceptance:** the shell renders all routes with placeholder panels.

---

## Phase 11: Frontend Web3 and data layer

- [ ] **11.1 Signers**
  - [ ] 11.1.1 *Demo mode*: `JsonRpcProvider(8545).getSigner(i)` for the role accounts (unlocked dev accounts; no keys in the frontend).
  - [ ] 11.1.2 *MetaMask*: `BrowserProvider`, `wallet_switchEthereumChain` / `wallet_addEthereumChain` for 31337, and the `accountsChanged` / `chainChanged` handlers.
- [ ] **11.2 Backend client**
  - [ ] 11.2.1 Typed REST client (from 8.3.1) and a WebSocket client with resume (8.2.2).
  - [ ] 11.2.2 Fallback mode when the backend is unreachable: read directly over JSON-RPC (`getRecords`, `queryFilter`), and disable history, mempool and lab features with a notice.
- [ ] **11.3 Stores**
  - [ ] 11.3.1 `ledgerStore` (records, products, verification), `txStore` (lifecycle per tx), `labStore` (mining mode, snapshots, tamper groups), `accountStore`, `lessonStore`.
  - [ ] 11.3.2 Handle `chain.rewound` and `chain.reset` by trimming or refetching state.
- [ ] **11.4 Independent verification**
  - [ ] 11.4.1 Re-run `@dpp/shared` `verifyEngine` in the browser on every change, and show a warning if it disagrees with the backend's verdict. This is part of the lesson: don't trust, verify.
- [ ] **11.5 Guards**
  - [ ] 11.5.1 Wrong-network banner, "contract not deployed" state, and node-restart detection with a hint about MetaMask's stale nonces.

**Acceptance:** live updates arrive over WebSocket. Switching roles changes `msg.sender`. Stopping the backend falls back cleanly.

---

## Phase 12: Chain visualization and hover details

- [ ] **12.1 Block card**
  - [ ] 12.1.1 Shows `#index`, action badge, product name, short `hash`, and short `prevHash` on the left edge that "plugs into" the previous card. Genesis marker before #0.
  - [ ] 12.1.2 Status styling from the verification engine.
- [ ] **12.2 Links**
  - [ ] 12.2.1 SVG connector labelled "prevHash = hash of #i-1". Green solid when intact, red dashed with a broken-link icon when not.
  - [ ] 12.2.2 Hovering a link highlights the two matching hash strings.
- [ ] **12.3 Hover tooltip**
  - [ ] 12.3.1 *Record*: all fields with role names, ETH and wei, local and unix time.
  - [ ] 12.3.2 *Transaction*: tx hash, Ethereum block, function and args, value, gas used, time from pending to mined.
  - [ ] 12.3.3 *Integrity*: data, link and anchor checks, each with a one-line reason.
  - [ ] 12.3.4 Opens on hover and keyboard focus, and closes on Esc.
- [ ] **12.4 Chain strip**
  - [ ] 12.4.1 Horizontal, virtualized, auto-follows the head. Jump-to, zoom and minimap.
  - [ ] 12.4.2 Product filter dims other records but keeps the global links. This teaches that there is one global chain.
  - [ ] 12.4.3 Two-layer view: an Ethereum-block lane above the ledger, with lines from each block to the records it created. Failed, replaced and dropped txs appear in the Ethereum lane (or the mempool tray) with no line down.
- [ ] **12.5 Record detail drawer**
  - [ ] 12.5.1 "How is this hash made?" step-through from `explainHash`.
  - [ ] 12.5.2 "Verify it yourself" runs the recipe in the browser and compares with on-chain `inspectRecord`.
  - [ ] 12.5.3 Links to the product trail, the creating tx and the record's storage slots (Phase 15).
- [ ] **12.6 Creating-chain animation**
  - [ ] 12.6.1 Ghost card slides in, `prevHash` "copies" the head's hash, the hash digits scramble into the result, and the link draws in green.
  - [ ] 12.6.2 Reduced-motion alternative: instant insert with a highlight flash.
- [ ] **12.7 Product timeline**
  - [ ] 12.7.1 Vertical trail per product, including reservations and revocations. Selecting a step highlights its block.

**Acceptance:** every hover shows complete and correct data, and new records animate in.

---

## Phase 13: Step-by-step transaction pipeline

- [ ] **13.1 Action panel**
  - [ ] 13.1.1 Forms for Register, List, Cancel listing, Buy (instant), Reserve, Confirm sale, Revoke, Reject, Expire and Withdraw, with an "Act as" role selector.
  - [ ] 13.1.2 Each form shows a prediction ("You are not the owner, so this will revert") but still allows sending.
- [ ] **13.2 Pipeline**
  - [ ] 13.2.1 Browser stages Draft → Simulated (`staticCall`) → Signed, then backend stages Pending → Mined → Recorded → Verified, or a failure branch.
  - [ ] 13.2.2 Clicking a stage shows its payload with an explanation (for example "the first 4 bytes `0xd96a094a` select `buy(uint256)`").
  - [ ] 13.2.3 "Recorded" hands off to the chain strip's creating animation.
- [ ] **13.3 Step mode**
  - [ ] 13.3.1 Toggle → `POST /api/lab/mining {manual}`. Pending txs collect in the mempool tray.
  - [ ] 13.3.2 "Mine block" button. Txs fly into an Ethereum block, then their records appear.
  - [ ] 13.3.3 Slow-motion option (`interval` mining).
- [ ] **13.4 Activity feed**
  - [ ] 13.4.1 All txs from `/api/txs`, filterable by state, account and product. Each row replays its pipeline.

**Acceptance:** in step mode, a Buy visibly passes through every stage with real data from the node and backend.

---

## Phase 14: Failed and revoked transactions

- [ ] **14.1 Failure before sending**
  - [ ] 14.1.1 `staticCall` failure stops the pipeline at "Simulated ✕" with the decoded explanation, and offers **Fix it** or **Send anyway**.
- [ ] **14.2 Failure on chain**
  - [ ] 14.2.1 "Send anyway" sets an explicit `gasLimit`, so ethers skips `estimateGas`. The dev node returns a hash because of 4.1.2.
  - [ ] 14.2.2 The backend's `tx.failed` message (decoded from the trace) drives the UI: gas spent, error, and "ledger length unchanged".
  - [ ] 14.2.3 Rejected-block animation: a red ghost card reaches for the head, shakes, its link snaps, and it drops into the **Failed attempts** tray.
  - [ ] 14.2.4 Explanation: "A revert rolls back every state change, including `_appendRecord`. You still paid gas, and the attempt is on the Ethereum chain, but never in the ledger."
- [ ] **14.3 "Try to break the rules"**: one button per error in 5.4.2, each starting from a state that triggers it (using lab scenarios where needed, for example a reserved product for `ProductReserved`).
- [ ] **14.4 Revocation, level 1: listing withdrawn**
  - [ ] 14.4.1 `Delisted` card and timeline step: "The listing is withdrawn, but the fact that it was listed stays."
- [ ] **14.5 Revocation, level 2: purchase revoked (escrow)**
  - [ ] 14.5.1 Visual escrow vault between buyer and seller on the product timeline. Funds move in on `Reserved`, then to the seller on confirm or back to the buyer on `Revoked`.
  - [ ] 14.5.2 Three revocation buttons (buyer cancels, seller rejects, expiry with a "fast-forward time" button that calls `/api/lab/time`).
  - [ ] 14.5.3 Pull-payment step: the refund sits in `pendingWithdrawals` until **Withdraw**. Compare with Broken Wallet: escrow succeeds, but only its own withdrawal fails.
  - [ ] 14.5.4 Explanation: "Revocation is a new record that reverses an earlier one. Nothing is deleted."
- [ ] **14.6 Revocation, level 3: transaction cancelled before mining**
  - [ ] 14.6.1 In step mode, each pending tx in the mempool tray has **Speed up**, **Cancel** (0-ETH self-transfer, same nonce, higher fee, signed by the user) and **Drop** (lab, demo only) buttons.
  - [ ] 14.6.2 The tracker's `tx.replaced` / `tx.dropped` messages strike through the tx, and no record appears.
  - [ ] 14.6.3 Explanation: "Before mining, a tx is only a request. After mining, it is final. Undoing it then needs a new, opposite transaction, like Revoked."
- [ ] **14.7 Failed attempts tray**
  - [ ] 14.7.1 Lists failed, replaced and dropped txs. Hovering shows the tooltip format with a "not in ledger" banner.

**Acceptance:** every error in 5.4.2 can be triggered from the UI and leaves `ledgerLength()` unchanged. All three revocation levels work end to end.

---

## Phase 15: Storage explorer

**Goal:** answer "where and how is a record stored?".

- [ ] **15.1 Record → slots view**
  - [ ] 15.1.1 For a selected record, show its 8 slots: slot number, raw 32-byte value and decoded field. Slot 3 shows the packed `action` + `actor` split visually.
  - [ ] 15.1.2 Explain the maths: array length at slot 0, data at `keccak256(0) + 8·index`.
- [ ] **15.2 Write cost view**
  - [ ] 15.2.1 For the creating tx, list the storage writes from the trace (6.5.4) with gas: new slots (cold, zero to non-zero) vs updates.
  - [ ] 15.2.2 Comparison card: "This record cost about 245k gas to store. The same data in an event costs a fraction of that, but contracts can't read events." Ties into README §12.
- [ ] **15.3 Reading back**
  - [ ] 15.3.1 Side by side: `getRecord(i)` (ABI-decoded call), raw `eth_getStorageAt`, and the event log entry, with all three matching while the chain is intact.

**Acceptance:** for any record, the three read-back paths match, and the slot view's values equal `eth_getStorageAt`.

---

## Phase 16: Tamper Lab

**Goal:** attack the ledger and watch each defence react. Local chain only.

- [ ] **16.1 Entry and safety**
  - [ ] 16.1.1 On entering, call `POST /api/lab/snapshot {name: "lab-entry"}`. Persistent banner: "Editing contract storage directly is only possible on a local dev chain."
  - [ ] 16.1.2 **Undo last attack** (journal) and **Restore everything** (snapshot) buttons.
- [ ] **16.2 Attack levels** (each a guided step with before/after values)
  - [ ] 16.2.1 **Level 1: Edit data only** (`mode: data`). Card *i* cracks red, links stay green. `verifyLedger()` → `(false, i)`. `auditRange` → `[i: data]`. Lesson: a hash is a fingerprint.
  - [ ] 16.2.2 **Level 2: Edit data and fix its hash** (`mode: data+hash`). Card *i* looks consistent, but the link *i → i+1* snaps. `verifyLedger()` → `(false, i+1)`. Lesson: each record locks in the one before it.
  - [ ] 16.2.3 **Level 3: Rewrite the tail** (`mode: rewrite-tail`). A "re-mining" wave crosses the cards. `verifyLedger()` → **`(true, 0)`**. The on-chain check is fooled, but the anchor check turns *i…head* purple, because the event log (Phase 2) still holds the original `prevHash`/`hash`. Lesson: a hash chain proves consistency, not authenticity, so it needs an anchor that the attacker can't rewrite.
  - [ ] 16.2.4 **Level 4: Two separate tampers.** `verifyLedger` reports only the first, while `auditRange` and the off-chain engine report both.
- [ ] **16.3 Animations**
  - [ ] 16.3.1 Crack (level 1), snap and drift apart (level 2), recompute wave and purple seals (level 3), re-snap from genesis forward on restore.
- [ ] **16.4 Verification console**
  - [ ] 16.4.1 Buttons for `verifyLedger()`, `verifyRange(from, to)` (range slider over the strip), `auditRange`, and **Full audit** (browser engine).
  - [ ] 16.4.2 Results table: on-chain vs off-chain verdicts, with the reason for each difference.

**Acceptance:** each level gives exactly the verdicts predicted above, and undo and restore return the chain to `intact`.

---

## Phase 17: Educational layer

- [ ] **17.1 Explanation panel**: contextual narration for every store event, in Beginner and Detailed modes (Detailed shows the relevant Solidity snippet, for example `_requirePurchasable`).
- [ ] **17.2 Lesson engine**: steps with a highlighted target, an instruction and a completion condition. Each lesson starts from a named snapshot or a lab scenario.
- [ ] **17.3 Lessons**
  1. *What is a block?* Hover a record and find its `prevHash`.
  2. *Making a chain.* Register a product and watch the link form.
  3. *A sale, step by step.* Step mode, mining manually.
  4. *Rules and reverts.* Trigger three errors and see why nothing was recorded.
  5. *Three ways to take something back.* Delist, revoke a reservation, cancel a pending tx.
  6. *Push vs pull payments.* Broken Wallet with instant buy vs escrow.
  7. *Where records live.* Storage explorer and gas cost.
  8. *Breaking the chain.* Tamper Lab levels 1–4.
  9. *Following a product.* Trace the laptop from manufacturer to customer.
- [ ] **17.4 Story replay**: the seed story in slow motion with narration, run by the lab scenario runner.
- [ ] **17.5 Glossary**: hash, keccak256, nonce, gas, revert, mempool, genesis, wei, escrow, slot, event log, with tooltip definitions throughout.
- [ ] **17.6 Progress**: lesson progress in `localStorage`, wrapped in try/catch, and the app works without it. Each lesson ends with a 2–3 question check.

**Acceptance:** a newcomer can complete all lessons without outside help.

---

## Phase 18: Testing and quality

- [ ] **18.1 Contracts**: existing suite plus `inspection.test.js` and `escrow.test.js`. Add `hardhat-gas-reporter` output to the README. Optional: `solidity-coverage` ≥ 95 % lines.
- [ ] **18.2 Shared**: parity, verification, error and slot tests (5.6).
- [ ] **18.3 Backend**: lifecycle (7.4), API (8.4), lab (9.7), reorg after `evm_revert`, node-restart session switch, resume after backend restart.
- [ ] **18.4 End to end (Playwright)**: global setup starts the node (`DEV_NODE=1`), deploys, seeds and starts the backend. Covers tooltips, a step-mode buy, every failure button, all three revocation levels, the storage explorer matching `eth_getStorageAt`, tamper levels 1–4, and backend-down fallback.
- [ ] **18.5 Accessibility and performance**: keyboard navigation, focus tooltips, ARIA live region, colour-blind-safe palette, reduced motion. Test with `bulk(1000)`: smooth scrolling, indexer backfill in under 10 s, incremental UI updates.
- [ ] **18.6 Manual MetaMask checklist**: add network, import an account, sign each action, reject a signature, replace a pending tx, restart the node and recover.
- [ ] **18.7 CI** (GitHub Actions): contract tests → shared and backend unit tests → build → Playwright, on every push.

---

## Phase 19: Documentation, polish and optional testnet

- [ ] **19.1 README**
  - [ ] 19.1.1 New sections: architecture, `npm run dev`, Demo vs MetaMask, page tour with GIFs, API overview (link to the OpenAPI spec), escrow and revocation.
  - [ ] 19.1.2 Update "Possible extensions": the web frontend and pull payments are done.
  - [ ] 19.1.3 Troubleshooting: stale MetaMask nonces, `DEV_NODE` not set (failed txs throw instead of mining), wrong chain id, contract missing after a restart.
- [ ] **19.2 Polish**: empty states, skeletons, error boundaries, copy buttons on all hashes and addresses.
- [ ] **19.3 Optional Sepolia**
  - [ ] 19.3.1 RPC URL and deployer key from `.env` (git-ignored).
  - [ ] 19.3.2 The backend indexer works unchanged, except tracing (most hosted RPCs don't offer `debug_traceTransaction`, so it falls back to `eth_call` at the parent block) and the lab, which is disabled by the guard.
  - [ ] 19.3.3 The frontend hides the Tamper Lab, step mode and drop features off-localhost.

---

# Part D: Timeline, dependencies and risks

## Timeline

Estimates assume one developer familiar with Solidity, Node and React.

| Phase | Track | Estimate | Depends on |
|---|---|---|---|
| 0 Setup | — | 0.5 day | — |
| 1 Read and inspection API | Contracts | 1.5 days | 0 |
| 2 Event enrichment | Contracts | 0.5 day | 1 |
| 3 Escrow and revocation | Contracts | 2.5–3 days | 1 |
| 4 Dev chain, export, scenarios | Contracts | 1.5 days | 1–3 |
| 5 Shared package | Shared | 2 days | 4 |
| 6 Indexer | Backend | 3–4 days | 5 |
| 7 Lifecycle tracker | Backend | 2 days | 6 |
| 8 API | Backend | 2 days | 6, 7 |
| 9 Lab controller | Backend | 2.5 days | 6, 8 |
| 10 Frontend scaffold | Frontend | 1 day | 0 (can start early) |
| 11 Web3 and data layer | Frontend | 2 days | 8, 10 |
| 12 Chain visualization | Frontend | 3–4 days | 11 |
| 13 Pipeline | Frontend | 2.5 days | 11, 12 |
| 14 Failed and revoked | Frontend | 3 days | 3, 9, 13 |
| 15 Storage explorer | Frontend | 1.5 days | 6.5.4, 12 |
| 16 Tamper Lab | Frontend | 2.5 days | 9, 12 |
| 17 Educational layer | Frontend | 3–4 days | 12–16 |
| 18 Testing and CI | All | 3 days (plus ongoing) | all |
| 19 Docs and polish | All | 1.5 days | all |
| | | **≈ 42–50 working days** | |

## Milestones

- **M1 "Contracts ready"** (P0–P4): extended contracts, tests, dev chain with scenarios.
- **M2 "Backend ready"** (P5–P9): indexer, lifecycle, API, lab. Usable from `curl`.
- **M3 "See and act"** (P10–P13): explorer and playground with live pipeline.
- **M4 "Failures, revocations, storage, tampering"** (P14–P16).
- **M5 "Teach it"** (P17–P19).

## Parallel work

```
P0 ─► P1 ─┬─► P2 ─────────────┐
          └─► P3 ─────────────┴─► P4 ─► P5 ─► P6 ─┬─► P7 ─► P8 ─► P9 ──┐
P0 ─► P10 (frontend scaffold, any time) ───────────┴──────► P11 ─► P12 ─┴─► P13 ─► P14
                                                                  P12 ─► P15, P16 ─► P17 ─► P18/P19
```

With two developers, one can take the contract and backend track and the other the frontend track (starting with P10 and mock API data), which brings the elapsed time down to about 5–6 weeks.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Off-chain hash doesn't match on-chain (for example enum encoding) | Shared parity tests against seeded fixtures (5.6.1), and again after the escrow actions are added (3.3.5) |
| Storage slots shift when escrow state is added | Slots always come from the compiler's `storageLayout` (4.1.3). `_ledger` stays first because `HashChainLedger` is the first base with state |
| Reverting txs throw instead of mining | `DEV_NODE=1` sets `throwOnTransactionFailures: false` for the node only. Troubleshooting entry. Backend `/api/session` reports the flag status |
| `npm test` breaks because of node-only settings | Settings are gated on `DEV_NODE` (verified: setting them globally breaks 7 tests) |
| Indexer shows stale data after `evm_revert` or tampering | Parent-hash rewind (6.7) and storage re-scan after lab writes (6.8) |
| Snapshot ids are single-use | Re-snapshot right after each restore (9.4.2) |
| Escrow adds reentrancy or locked-funds bugs | CEI ordering, pull payments, reentrancy test (3.3.6), expiry so funds can't stay locked |
| Learners think tampering is possible on real Ethereum | Lab is local-only and fenced by the guard, with a permanent banner and lesson text explaining why |
| MetaMask nonce or cache errors after a node restart | Session detection, a UI hint, Demo mode as the default |
| Hosted RPCs lack `debug_traceTransaction` (testnet) | `eth_call` replay fallback, with results flagged as approximate |
| Scope creep (three tracks) | Milestones M1–M5 each ship something usable. M3 alone already meets the core visualization requirement |
