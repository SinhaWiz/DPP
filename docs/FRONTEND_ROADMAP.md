# Web3 Frontend: Implementation Roadmap

A plan for adding an interactive, educational web frontend to the Buy/Sell Traceability simulation. The frontend will:

- Show every transaction **step by step**, from building it to it being mined and recorded.
- Show **failed** (reverted) transactions and **revoked** (cancelled or replaced) transactions, and explain why they never become ledger records.
- Draw the ledger as a **chain of blocks**. Hovering a block shows its full record and transaction details.
- Animate **creating** a chain (a new record linking to the previous hash) and **breaking** one (tampering with storage and watching verification fail).
- Teach as it goes: every visual has a plain-language explanation next to it.

The plan builds on the existing contracts without changing their behaviour. Phase 1 adds one small read function for bulk loading.

---

## Contents

0. [Key concepts the UI must get right](#0-key-concepts-the-ui-must-get-right)
1. [Architecture and tech stack](#1-architecture-and-tech-stack)
2. [Phase 0: Decisions and repo setup](#phase-0-decisions-and-repo-setup)
3. [Phase 1: Contract and dev-environment groundwork](#phase-1-contract-and-dev-environment-groundwork)
4. [Phase 2: Frontend scaffold](#phase-2-frontend-scaffold)
5. [Phase 3: Web3 connection layer](#phase-3-web3-connection-layer)
6. [Phase 4: Ledger data and off-chain verification engine](#phase-4-ledger-data-and-off-chain-verification-engine)
7. [Phase 5: Chain visualization and hover details](#phase-5-chain-visualization-and-hover-details)
8. [Phase 6: Step-by-step transaction pipeline](#phase-6-step-by-step-transaction-pipeline)
9. [Phase 7: Failed and revoked transactions](#phase-7-failed-and-revoked-transactions)
10. [Phase 8: Tamper Lab (breaking and repairing chains)](#phase-8-tamper-lab-breaking-and-repairing-chains)
11. [Phase 9: Educational layer](#phase-9-educational-layer)
12. [Phase 10: Testing and quality](#phase-10-testing-and-quality)
13. [Phase 11: Documentation, polish and optional testnet](#phase-11-documentation-polish-and-optional-testnet)
14. [Timeline summary](#timeline-summary)
15. [Risks and mitigations](#risks-and-mitigations)

---

## 0. Key concepts the UI must get right

The project has **two chains**, and the frontend should never blur them:

| | Ethereum chain (Hardhat network) | Ledger chain (inside the contract) |
|---|---|---|
| Unit | Ethereum block (contains transactions) | `Record` in `_ledger[]` |
| Link | Block header's `parentHash` | `Record.prevHash` → previous `Record.hash` |
| Created by | Mining (`evm_mine` / automine) | `_appendRecord()` during a successful tx |
| Failed tx | Mined with `status = 0` (gas spent) | **Nothing appended.** A revert undoes all state changes |

Four facts from the current contracts shape the design:

1. **Reverted transactions leave no record.** Every guard (`EmptyName`, `NotProductOwner`, `IncorrectPayment`, …) reverts the whole call, so a failed attempt can only be shown from the transaction receipt and the decoded error, never from the ledger. The UI should say this explicitly.
2. **"Revoked" has two meanings, and the UI should show both:**
   - *Business-level revocation*: `cancelListing()` writes a `Delisted` record. It **is** in the ledger.
   - *Transaction-level revocation*: a **pending** transaction is cancelled before it is mined, either replaced (same nonce, higher fee) or dropped. It never executes. This can only be shown with automine off.
3. **On-chain verification does not cascade.** If record *i*'s data is changed, `_verify` flags record *i* because its recomputed hash differs from its stored `hash`. Record *i+1*'s `prevHash` still equals *i*'s **stored** hash, so the link looks fine. Links break only when the attacker also rewrites the stored hash. The Tamper Lab (Phase 8) teaches this progression.
4. **Events are an independent witness.** `RecordAppended(index, productId, action, hash)` is stored in transaction logs, not contract storage. `hardhat_setStorageAt` cannot alter it. Comparing stored hashes against event hashes catches even a full, self-consistent rewrite of the chain.

---

## 1. Architecture and tech stack

```
┌──────────────────────────── Browser (frontend/) ────────────────────────────┐
│                                                                              │
│  UI layer        ChainView · TxPipeline · ActionPanel · TamperLab · Lessons  │
│                         ▲                     │                              │
│  State (Zustand)  ledgerStore · txStore · accountStore · lessonStore         │
│                         ▲                     │                              │
│  Domain logic     verifyEngine · hashRecipe · errorExplainer · storageLayout │
│                         ▲                     │                              │
│  Web3 layer       providers (MetaMask | Demo accounts) · contract client     │
│                   eventWatcher · txTracker · devRpc (hardhat_* / evm_*)      │
└─────────────────────────┬─────────────────────┬──────────────────────────────┘
                          │ JSON-RPC            │ JSON-RPC (dev methods)
                          ▼                     ▼
               ┌──────────────────────────────────────────┐
               │  npx hardhat node  (localhost:8545, 31337) │
               │  BuySellTraceability · EtherRejecter       │
               └──────────────────────────────────────────┘
```

| Concern | Choice | Why |
|---|---|---|
| Build tool | **Vite + React 18 + TypeScript** | Fast dev server; typed records and errors |
| Web3 library | **ethers v6** | Already used by the Hardhat scripts and tests, so the hash code can be shared almost line for line |
| Wallets | **MetaMask** (`BrowserProvider`) **and Demo mode** (`JsonRpcProvider.getSigner(i)` with Hardhat's unlocked accounts) | Demo mode needs no extension and allows one-click role switching (Manufacturer, Distributor, …) |
| State | **Zustand** | Small and works outside React (event listeners, tx tracker) |
| Animation | **Framer Motion** | Block insert, link draw, shake-and-drop for failures, crack effect for tampering |
| Tooltips | **@floating-ui/react** | Accessible hover and focus tooltips that stay inside the viewport |
| Styling | **Tailwind CSS** | Quick to build a consistent visual language (colours per action and per status) |
| Long chains | **@tanstack/react-virtual** (horizontal) | Keeps the chain smooth past a few hundred records |
| Tests | **Vitest** (logic), **Playwright** (end to end against a live Hardhat node) | |

Proposed folder layout:

```
Buy_sell_simulation/
├── contracts/ scripts/ test/          (existing)
├── scripts/
│   ├── deploy.js                      (extended: writes frontend deployment file)
│   └── seed.js                        (new: replays the supply-chain story)
├── frontend/
│   ├── package.json  vite.config.ts  tailwind.config.ts
│   └── src/
│       ├── contracts/deployment.json  (generated: address, chainId, abi, deployBlock, storage slots)
│       ├── web3/        providers.ts  contract.ts  devRpc.ts  eventWatcher.ts  txTracker.ts
│       ├── domain/      types.ts  hashRecipe.ts  verifyEngine.ts  errorExplainer.ts  storageLayout.ts
│       ├── store/       ledgerStore.ts  txStore.ts  accountStore.ts  lessonStore.ts
│       ├── components/  chain/  pipeline/  actions/  tamper/  lessons/  common/
│       └── pages/       Explorer.tsx  Playground.tsx  TamperLab.tsx  Learn.tsx
└── docs/FRONTEND_ROADMAP.md
```

---

## Phase 0: Decisions and repo setup

**Goal:** settle the choices that are expensive to change later.

- [ ] **0.1 Confirm scope**
  - [ ] 0.1.1 Local Hardhat node is the primary target. A Sepolia deploy is optional (Phase 11), and the Tamper Lab and mining controls are disabled there.
  - [ ] 0.1.2 Confirm the definitions of "failed" and "revoked" from [section 0](#0-key-concepts-the-ui-must-get-right).
- [ ] **0.2 Repo layout**
  - [ ] 0.2.1 Create `frontend/` as its own npm package so the Hardhat project's dependencies stay untouched.
  - [ ] 0.2.2 Add root scripts: `"dev:node"`, `"dev:deploy"`, `"dev:web"`, and `"dev"` (runs all three with `concurrently`).
  - [ ] 0.2.3 Extend `.gitignore` with `frontend/node_modules/`, `frontend/dist/`, `playwright-report/`, `test-results/`.
- [ ] **0.3 Design language** (one page, agreed before building components)
  - [ ] 0.3.1 Colour per action: Registered = blue, Listed = amber, Delisted = grey, Sold = green.
  - [ ] 0.3.2 Colour per status: intact link = green, data-hash mismatch = red, broken link = red dashed, event mismatch = purple, pending = pulsing outline, failed = red with ✕.
  - [ ] 0.3.3 Pair every colour with an icon or label, so nothing depends on colour alone.

**Deliverable:** empty `frontend/` package, root scripts, a short design-tokens note.

---

## Phase 1: Contract and dev-environment groundwork

**Goal:** give the frontend everything it needs from the chain side without changing the existing behaviour.

- [ ] **1.1 Bulk read function** (small additive change)
  - [ ] 1.1.1 Add `getRecords(uint256 offset, uint256 limit) returns (Record[] memory)` to `ITraceabilityLedger` and `HashChainLedger`, using the same clamping rules as `_historyPage`.
  - [ ] 1.1.2 Add tests to `test/BuySellTraceability.test.js`: window, clamped last page, empty page for out-of-range offset.
  - [ ] 1.1.3 Update the README read-API table.
  - *Why:* loading N records with `getRecord(i)` takes N RPC calls; pages of 50 take ⌈N/50⌉.
- [ ] **1.2 Hardhat network config**
  - [ ] 1.2.1 Set `networks.hardhat.chainId = 31337` explicitly and `mining: { auto: true, interval: 0 }` so manual mining can be toggled at runtime.
  - [ ] 1.2.2 Enable `storageLayout` in `outputSelection` so the exact slots of `_ledger` are known and the test's slot probing isn't needed in the frontend.
- [ ] **1.3 Deployment export** (`scripts/deploy.js`)
  - [ ] 1.3.1 Deploy `BuySellTraceability`, plus an `EtherRejecter` used to demonstrate `PaymentFailed`.
  - [ ] 1.3.2 Write `frontend/src/contracts/deployment.json` with: `chainId`, contract addresses, ABIs, `deployBlock`, and `_ledger`'s base slot from the storage layout.
  - [ ] 1.3.3 Fail loudly if run against an unexpected chain id.
- [ ] **1.4 Seed script** (`scripts/seed.js`)
  - [ ] 1.4.1 Replay the Manufacturer → Distributor → Retailer → Customer story from `simulate.js` against `localhost`.
  - [ ] 1.4.2 Add a second product with a list → cancel (Delisted) → relist → sell flow, so revocation records exist from the start.
  - [ ] 1.4.3 Optional flag `--with-failures` that sends a few deliberately reverting txs with a manual gas limit, so the failed-tx history isn't empty.
- [ ] **1.5 Account roles file**
  - [ ] 1.5.1 Map Hardhat accounts #0–#4 to Manufacturer, Distributor, Retailer, Customer, Outsider, and add the EtherRejecter as "Broken Wallet".
  - [ ] 1.5.2 Shared by `seed.js` and the frontend (export to `frontend/src/contracts/roles.json`).

**Acceptance:** `npm run dev:node` + `npm run dev:deploy` produces a populated ledger and a valid `deployment.json`. `npm test` still passes, including the new `getRecords` tests.

---

## Phase 2: Frontend scaffold

**Goal:** a running app shell with navigation and layout.

- [ ] **2.1 Create the app**
  - [ ] 2.1.1 `npm create vite@latest frontend -- --template react-ts`.
  - [ ] 2.1.2 Install `ethers@6`, `zustand`, `framer-motion`, `@floating-ui/react`, `@tanstack/react-virtual`, `tailwindcss`, `react-router-dom`.
  - [ ] 2.1.3 Configure path aliases (`@/web3`, `@/domain`, …) and strict TypeScript.
- [ ] **2.2 Layout**
  - [ ] 2.2.1 Top bar: network badge (chain id, block number), account switcher, mining-mode toggle.
  - [ ] 2.2.2 Main area: the **chain strip** across the full width (Phase 5).
  - [ ] 2.2.3 Left drawer: **Action panel** (Phase 6). Right drawer: **Explanation panel** that narrates whatever just happened (Phase 9).
  - [ ] 2.2.4 Bottom dock: **Transaction pipeline** and activity feed (Phases 6–7).
- [ ] **2.3 Pages / routes**
  - [ ] 2.3.1 `/` **Explorer**: read-only view of the ledger and products.
  - [ ] 2.3.2 `/playground`: perform actions as any role.
  - [ ] 2.3.3 `/tamper`: Tamper Lab (local network only).
  - [ ] 2.3.4 `/learn`: guided lessons.
- [ ] **2.4 Shared primitives**
  - [ ] 2.4.1 `<Address>` (role name, short address, copy button), `<Hash>` (first and last 4 bytes, full value on hover), `<Eth>` (wei → ETH with exact wei in tooltip), `<ActionBadge>`, `<StatusPill>`.
  - [ ] 2.4.2 Dark and light theme from the design tokens.

**Acceptance:** `npm run dev:web` shows the shell with all routes and placeholder panels.

---

## Phase 3: Web3 connection layer

**Goal:** a reliable, typed bridge between the UI and the chain.

- [ ] **3.1 Providers** (`web3/providers.ts`)
  - [ ] 3.1.1 *Read provider*: `JsonRpcProvider("http://127.0.0.1:8545")`, always on, so the Explorer works without a wallet.
  - [ ] 3.1.2 *Demo mode signer*: `readProvider.getSigner(index)` for the role accounts. Hardhat accounts are unlocked, so no private keys are stored in the frontend.
  - [ ] 3.1.3 *MetaMask signer*: `BrowserProvider(window.ethereum)`. Request accounts, then `wallet_switchEthereumChain` / `wallet_addEthereumChain` for 31337.
  - [ ] 3.1.4 Handle `accountsChanged` and `chainChanged` events.
- [ ] **3.2 Network guard**
  - [ ] 3.2.1 Compare the connected chain id with `deployment.json`. Show a blocking banner with a "Switch network" button on mismatch.
  - [ ] 3.2.2 Detect "contract not deployed" (`getCode(address) === "0x"`) after a node restart and tell the user to re-run the deploy.
  - [ ] 3.2.3 Detect a restarted node (block number went backwards) and offer a full refresh. Note in the docs that MetaMask needs "Clear activity tab data" after a restart because of stale nonces.
- [ ] **3.3 Typed contract client** (`web3/contract.ts`)
  - [ ] 3.3.1 Wrap `BuySellTraceability` with typed methods: `registerProduct`, `listForSale`, `cancelListing`, `buy`, plus reads (`getRecords`, `getProduct`, `productCount`, `verifyLedger`, `verifyRange`, `getProductHistory`).
  - [ ] 3.3.2 Convert `Result` tuples to plain TS objects (`Record`, `Product`), keeping `bigint` for amounts and indexes.
- [ ] **3.4 Error decoding** (`domain/errorExplainer.ts`)
  - [ ] 3.4.1 Decode revert data with `contract.interface.parseError(data)` into `{ name, args }`.
  - [ ] 3.4.2 Map each custom error to a plain-English explanation and a "how to fix" hint:

    | Error | Explanation shown |
    |---|---|
    | `EmptyName` | Products need a name. The contract refuses an empty string. |
    | `InvalidPrice` | A listing price must be above 0 wei. |
    | `ProductNotFound(id)` | Product #id was never registered. |
    | `NotProductOwner(id, caller)` | Only the current owner may list or delist. *caller* isn't the owner. |
    | `NotListed(id)` | The product isn't for sale, so it can't be bought or delisted. |
    | `CannotBuyOwnProduct(id)` | The seller and buyer are the same account. |
    | `IncorrectPayment(expected, sent)` | The exact price must be sent: expected *X* ETH, sent *Y* ETH. |
    | `PaymentFailed(recipient)` | The seller is a contract that refuses ETH, so the whole sale was rolled back. |

  - [ ] 3.4.3 Fallbacks for non-contract failures: user rejected the signature, insufficient funds, nonce too low.
- [ ] **3.5 Dev RPC helpers** (`web3/devRpc.ts`, local network only)
  - [ ] 3.5.1 `getAutomine` / `setAutomine(bool)` → `hardhat_getAutomine` / `evm_setAutomine`.
  - [ ] 3.5.2 `mine()` → `evm_mine`. `setNextTimestamp()` → `evm_setNextBlockTimestamp`.
  - [ ] 3.5.3 `snapshot()` / `revert(id)` → `evm_snapshot` / `evm_revert` (used to undo tampering).
  - [ ] 3.5.4 `setStorageAt(addr, slot, value)` → `hardhat_setStorageAt`.
  - [ ] 3.5.5 `dropTransaction(hash)` → `hardhat_dropTransaction`. `pendingTxs()` → `eth_getBlockByNumber("pending", true)`.
  - [ ] 3.5.6 Feature-detect each method once and hide the controls that depend on a method the node doesn't support.
- [ ] **3.6 Event watcher** (`web3/eventWatcher.ts`)
  - [ ] 3.6.1 On load, backfill `RecordAppended` and the product events from `deployBlock` with `queryFilter`, in block ranges of 5,000.
  - [ ] 3.6.2 Subscribe to new blocks (`provider.on("block")`) and fetch logs for each new block, which works the same with automine on or off.
  - [ ] 3.6.3 Push decoded events into `ledgerStore` with `{ txHash, blockNumber, logIndex }` for anchoring.

**Acceptance:** with the seeded node, the console shows decoded records and events. Switching roles in Demo mode changes `msg.sender`. A deliberate bad call shows the right explanation.

---

## Phase 4: Ledger data and off-chain verification engine

**Goal:** the frontend recomputes and checks every hash itself instead of trusting `verifyLedger()`, which is the auditor's view described in README §9.

- [ ] **4.1 Ledger store** (`store/ledgerStore.ts`)
  - [ ] 4.1.1 State: `records[]`, `products{}`, `eventsByIndex{}`, `txByIndex{}` (Ethereum tx + block that created each record), `verification`.
  - [ ] 4.1.2 Initial load: `ledgerLength()`, then `getRecords` in pages of 50, then `getProduct` for `1..productCount`.
  - [ ] 4.1.3 Incremental update: on each new `RecordAppended`, fetch only the new record(s) and re-verify from that index.
- [ ] **4.2 Hash recipe** (`domain/hashRecipe.ts`)
  - [ ] 4.2.1 Port `_computeHash` exactly:
    ```ts
    keccak256(AbiCoder.defaultAbiCoder().encode(
      ["uint256","uint256","uint256","uint8","address","address","uint256","bytes32"],
      [r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash]))
    ```
  - [ ] 4.2.2 Also return the intermediate pieces (each field's 32-byte word and the concatenated encoding) for the "How is this hash made?" panel (Phase 5.5).
  - [ ] 4.2.3 Vitest: matches the on-chain `hash` for every seeded record (fixture exported by `seed.js`).
- [ ] **4.3 Verification engine** (`domain/verifyEngine.ts`)
  - [ ] 4.3.1 Per record, compute three independent checks:
    - `dataOk`: recomputed hash === stored `hash` (catches edited fields)
    - `linkOk`: stored `prevHash` === previous record's stored `hash` (or `0x00…00` for #0) (catches rewritten hashes)
    - `anchorOk`: stored `hash` === hash in that index's `RecordAppended` event (catches a full rewrite)
  - [ ] 4.3.2 Derive the status: `intact` | `dataTampered` | `linkBroken` | `anchorMismatch`, plus `firstBrokenAt`.
  - [ ] 4.3.3 Also call on-chain `verifyLedger()` and show both results side by side. They agree on data and link failures. Only the off-chain engine catches anchor mismatches, which is a lesson in itself.
  - [ ] 4.3.4 Vitest cases: clean chain; one field edited; field and hash edited; tail fully rewritten.
- [ ] **4.4 Product trails**
  - [ ] 4.4.1 Group records by `productId` to build each product's ownership timeline (owner after each `Sold`).
  - [ ] 4.4.2 Cross-check with `getProductHistory(id, 0, n)`.

**Acceptance:** the engine reports `intact` for the seeded chain, and its hashes match the on-chain hashes byte for byte.

---

## Phase 5: Chain visualization and hover details

**Goal:** the centrepiece, a ledger you can see and explore.

- [ ] **5.1 Block component** (`components/chain/BlockCard.tsx`)
  - [ ] 5.1.1 Card shows: `#index`, action badge and icon, product name, short `hash`, and a short `prevHash` on the left edge that visually "plugs into" the previous card.
  - [ ] 5.1.2 Status styling from the verification engine (Phase 0.3.2).
  - [ ] 5.1.3 Genesis marker before #0 showing `prevHash = 0x00…00`.
- [ ] **5.2 Links** (`components/chain/ChainLink.tsx`)
  - [ ] 5.2.1 SVG connector between cards, labelled "prevHash = hash of #i-1".
  - [ ] 5.2.2 Green solid when `linkOk`, red dashed with a broken-link icon when not.
  - [ ] 5.2.3 Hovering a link highlights the two matching hash strings in both cards.
- [ ] **5.3 Hover tooltip** (`components/chain/BlockTooltip.tsx`)
  - [ ] 5.3.1 *Record*: index, action, product (#id + name), actor and counterparty (role names), price (ETH + wei), timestamp (local time + raw unix), `prevHash`, `hash`.
  - [ ] 5.3.2 *Transaction that created it*: tx hash, Ethereum block number, from, value, gas used, function called (`buy(1)` with decoded args).
  - [ ] 5.3.3 *Integrity*: ✔/✘ for data, link and anchor checks, with a one-line reason.
  - [ ] 5.3.4 Opens on hover **and** on keyboard focus. Tooltip is reachable with a pointer and dismissable with Esc.
- [ ] **5.4 Chain strip** (`components/chain/ChainStrip.tsx`)
  - [ ] 5.4.1 Horizontal, virtualized, auto-scrolls to the newest record. Has "Jump to #", zoom (compact cards ↔ full cards) and a minimap.
  - [ ] 5.4.2 **Product filter:** selecting a product dims all other records but keeps the global links visible. This teaches that there is **one global chain**, not one per product (README §12).
  - [ ] 5.4.3 Optional **two-layer view:** a thin lane above the ledger shows Ethereum blocks, with lines from each Ethereum block down to the record(s) its transactions created. Failed txs appear in the Ethereum lane with no line down.
- [ ] **5.5 Record detail drawer** (click a block)
  - [ ] 5.5.1 Full fields plus a **"How is this hash made?"** step-through: each field → 32-byte ABI word → concatenation → keccak256 → result (from 4.2.2).
  - [ ] 5.5.2 "Verify this record myself" button that runs the recipe live and compares results.
  - [ ] 5.5.3 Links to the product's full trail and to the creating transaction in the pipeline history.
- [ ] **5.6 Creating-chain animation**
  - [ ] 5.6.1 When a record arrives: a ghost card slides in, its `prevHash` field "copies" the previous card's `hash` (animated text flight), its own hash is computed (digit-scramble effect), then the link draws and turns green.
  - [ ] 5.6.2 Respect `prefers-reduced-motion`: use instant transitions with a highlight flash instead.
- [ ] **5.7 Product timeline view**
  - [ ] 5.7.1 Vertical timeline per product: Registered → Listed → Sold → …, with owner avatars and prices. Selecting a step highlights its block in the chain strip.

**Acceptance:** the seeded ledger renders as a linked chain. Every hover shows complete, correct information. A new record animates into place.

---

## Phase 6: Step-by-step transaction pipeline

**Goal:** make the life of a transaction visible, stage by stage.

- [ ] **6.1 Action panel** (`components/actions/`)
  - [ ] 6.1.1 Forms for Register, List, Cancel listing and Buy. "Act as" role selector. Buy pre-fills the exact listed price.
  - [ ] 6.1.2 Hints next to each button, for example "You are not the owner, so this will revert". The panel still lets the user send it, because failures are part of the lesson.
- [ ] **6.2 Transaction tracker** (`web3/txTracker.ts` + `store/txStore.ts`)
  - [ ] 6.2.1 Model each tx as a state machine:
    ```
    Draft → Simulated (staticCall ok | would revert) → Signed → Pending (in mempool)
          → Mined (status 1) → Record appended → Verified
          ↘ Mined (status 0, reverted)   ↘ Replaced / Dropped   ↘ Rejected by user
    ```
  - [ ] 6.2.2 Record a timestamp and payload per stage: calldata, decoded args, nonce, gas estimate, tx hash, block number, gas used, logs, new record index.
- [ ] **6.3 Pipeline view** (`components/pipeline/TxPipeline.tsx`)
  - [ ] 6.3.1 Horizontal stepper with one node per stage. The current stage pulses, finished stages show a check, failed stages show ✕.
  - [ ] 6.3.2 Clicking a stage shows its payload with a short explanation (for example "Calldata: the first 4 bytes `0xd96a094a` select `buy(uint256)`").
  - [ ] 6.3.3 At "Record appended", the pipeline hands off to the chain strip, which plays the creating-chain animation (5.6).
- [ ] **6.4 Step mode (manual mining)**
  - [ ] 6.4.1 A toggle in the top bar switches `evm_setAutomine(false)`. Txs then wait visibly in a **Mempool tray**.
  - [ ] 6.4.2 "Mine next block" button (`evm_mine`) includes all pending txs. The UI shows them moving into an Ethereum block, then the records appearing.
  - [ ] 6.4.3 "Auto-advance" option: mines every N seconds for a slow-motion demo.
  - [ ] 6.4.4 Turn automine back on when leaving the page, so MetaMask users aren't left with stuck txs.
- [ ] **6.5 Activity feed**
  - [ ] 6.5.1 Chronological list of all txs (success, failed, replaced) with filters. Each row links to its pipeline replay.

**Acceptance:** in step mode, a Buy visibly passes through every stage. Its record appears only after mining, and the pipeline shows the matching tx and block data.

---

## Phase 7: Failed and revoked transactions

**Goal:** show what *doesn't* make it into the chain, and why.

- [ ] **7.1 Failure before sending (simulation)**
  - [ ] 7.1.1 Every action first runs `contract.<fn>.staticCall(...)`. If it would revert, the pipeline stops at "Simulated ✕" with the decoded error from 3.4.
  - [ ] 7.1.2 Offer two buttons: **Fix it** (pre-fills a corrected form) or **Send anyway** (to watch an on-chain failure).
- [ ] **7.2 Failure on chain (mined but reverted)**
  - [ ] 7.2.1 "Send anyway" sets an explicit `gasLimit` (for example 300,000) so ethers skips `estimateGas`, which would refuse the reverting tx.
  - [ ] 7.2.2 The tx is mined with `status = 0`. Show the gas spent, the decoded error (re-run the call at that block to get revert data), and the absence of any new record.
  - [ ] 7.2.3 **Rejected-block animation:** a red ghost card tries to attach to the chain head, shakes, its link snaps, and it drops into a "Failed attempts" tray beneath the chain. The head and ledger length stay the same.
  - [ ] 7.2.4 Explanation panel: "A revert rolls back every state change in the transaction, including `_appendRecord`. The attempt is still on the Ethereum chain (you paid gas), but it can never appear in the ledger."
- [ ] **7.3 Scenario buttons for each error** (Playground → "Try to break the rules")
  - [ ] 7.3.1 Register with empty name → `EmptyName`.
  - [ ] 7.3.2 List at price 0 → `InvalidPrice`.
  - [ ] 7.3.3 Outsider lists someone else's product → `NotProductOwner`.
  - [ ] 7.3.4 Buy an unlisted product → `NotListed`.
  - [ ] 7.3.5 Owner buys their own product → `CannotBuyOwnProduct`.
  - [ ] 7.3.6 Pay 0.5 ETH for a 1 ETH item → `IncorrectPayment(1e18, 5e17)`.
  - [ ] 7.3.7 Buy from the "Broken Wallet" (EtherRejecter) → `PaymentFailed`. Explain that ownership and the ledger record were rolled back too, because state is changed before the ETH is sent (checks-effects-interactions) and the failed payment reverts everything.
- [ ] **7.4 Business-level revocation (Delisted)**
  - [ ] 7.4.1 Cancel listing creates a grey `Delisted` record. The tooltip explains: "The listing is withdrawn, but the history of it being listed stays. Append-only ledgers don't delete; they record a reversal."
  - [ ] 7.4.2 Product timeline shows Listed → Delisted as a crossed-out price tag.
- [ ] **7.5 Transaction-level revocation (pending tx cancelled)** (step mode only)
  - [ ] 7.5.1 With automine off, a pending tx in the Mempool tray gets two buttons:
    - **Speed up / Replace**: re-send the same nonce with a higher fee.
    - **Cancel**: send a 0-ETH self-transfer with the same nonce and a higher fee. Demo mode can also use `hardhat_dropTransaction`.
  - [ ] 7.5.2 After mining, the original tx is marked **Replaced** or **Dropped** (nonce used by another tx, original hash never mined), and no record appears.
  - [ ] 7.5.3 Explanation: "Before mining, a tx is only a request. Once mined, it is final. The only way to undo a sale is a new, opposite transaction, which this contract doesn't support."
- [ ] **7.6 Failed-attempts tray**
  - [ ] 7.6.1 Lists every failed, replaced and dropped tx with its reason. Hovering shows the same tooltip format as blocks, with a "not in ledger" banner.

**Acceptance:** each of the eight custom errors can be triggered from the UI, shows the correct explanation, and leaves `ledgerLength()` unchanged. Replace and cancel work in step mode.

---

## Phase 8: Tamper Lab (breaking and repairing chains)

**Goal:** let users attack the ledger and watch each defence react. Local Hardhat network only.

- [ ] **8.1 Storage layout helper** (`domain/storageLayout.ts`)
  - [ ] 8.1.1 Base slot of `_ledger` comes from `deployment.json` (Phase 1.2.2). Element base = `keccak256(abi.encode(slot))`.
  - [ ] 8.1.2 Record = 8 slots: `0 index · 1 timestamp · 2 productId · 3 action(uint8) + actor(address) packed · 4 counterparty · 5 price · 6 prevHash · 7 hash`.
  - [ ] 8.1.3 Writers for each field. The action/actor writer must read slot 3 and preserve the packed bits it doesn't change.
  - [ ] 8.1.4 Vitest against a live node: write a field, read it back through `getRecord`.
- [ ] **8.2 Safety net**
  - [ ] 8.2.1 Take `evm_snapshot` when entering the lab. A **Restore chain** button calls `evm_revert` and takes a fresh snapshot (snapshots are single-use).
  - [ ] 8.2.2 Persistent warning banner: "You are editing contract storage directly. This is only possible on a local dev chain."
- [ ] **8.3 Attack levels** (each a guided step with before/after)
  - [ ] 8.3.1 **Level 1: Edit data only.** Change record *i*'s price, buyer or action.
    - Result: the recomputed hash of *i* no longer matches its stored hash. Card *i* turns red with a "data doesn't match hash" crack. Links stay green. `verifyLedger()` → `(false, i)`.
    - Lesson: a hash is a fingerprint of the data.
  - [ ] 8.3.2 **Level 2: Edit data and recompute its hash.** Write the new correct hash into slot 7.
    - Result: card *i* now looks self-consistent, but the link *i → i+1* breaks (red dashed), because *i+1*'s `prevHash` still holds the old hash. `verifyLedger()` → `(false, i+1)`.
    - Lesson: each record locks in the one before it.
  - [ ] 8.3.3 **Level 3: Rewrite the whole tail.** One click recomputes `hash` and `prevHash` for every record from *i* to the head (animate the "re-mining" wave across the cards).
    - Result: `verifyLedger()` → **`(true, 0)`**. On-chain verification is fooled. The off-chain engine's **anchor check** turns cards *i…head* purple, because their stored hashes no longer match the `RecordAppended` events in the transaction logs.
    - Lesson: a hash chain alone proves internal consistency, not authenticity. It needs an anchor that the attacker can't rewrite (here: Ethereum logs and block hashes). This is why README §12 calls the in-contract chain redundant on a real blockchain.
  - [ ] 8.3.4 **Level 4 (optional): change history order.** Swap two records' data and show that the `index` field and the links expose it.
- [ ] **8.4 Breaking-chain animation**
  - [ ] 8.4.1 Level 1: card cracks and the hash digits flash red.
  - [ ] 8.4.2 Level 2: the link snaps, and the two halves of the chain drift apart slightly.
  - [ ] 8.4.3 Level 3: a wave of recomputation crosses the tail, then purple "anchor mismatch" seals appear.
  - [ ] 8.4.4 Restore: the chain re-snaps from the genesis end forward.
- [ ] **8.5 Verification controls**
  - [ ] 8.5.1 Buttons: `verifyLedger()`, `verifyRange(from, to)` with a range slider over the chain (shows that a range check only flags tampering inside the range, as in the existing test), and **Full audit** (off-chain engine).
  - [ ] 8.5.2 Results table: on-chain verdict vs off-chain data / link / anchor verdicts.

**Acceptance:** each level produces exactly the predicted on-chain and off-chain verdicts, and Restore returns the chain to `intact`.

---

## Phase 9: Educational layer

**Goal:** turn the tool into a self-guided lesson.

- [ ] **9.1 Explanation panel** (right drawer)
  - [ ] 9.1.1 Listens to store events (record appended, tx failed, tamper applied) and shows a short, contextual explanation with a "Learn more" link to the matching lesson.
  - [ ] 9.1.2 Beginner and Detailed modes. Detailed adds Solidity snippets (for example the `_requirePurchasable` checks for a failed Buy).
- [ ] **9.2 Guided lessons** (`/learn`, `store/lessonStore.ts`)
  - [ ] 9.2.1 Lesson engine: steps with highlighted UI targets, an instruction, and a completion condition (for example "wait until ledgerLength increases").
  - [ ] 9.2.2 Lessons:
    1. *What is a block?* Hover a record and find its prevHash.
    2. *Making a chain.* Register a product and watch the link form.
    3. *A sale, step by step.* List and buy in step mode, mining manually.
    4. *Rules and reverts.* Trigger three different errors and see why nothing was recorded.
    5. *Changing your mind.* Delist (ledger) vs cancel a pending tx (mempool).
    6. *Breaking the chain.* Tamper Lab levels 1–3.
    7. *Following a product.* Trace a laptop from manufacturer to customer.
  - [ ] 9.2.3 Each lesson starts from a known state (snapshot/revert or a fresh seed) and ends with a 2–3 question check.
- [ ] **9.3 Story replay**
  - [ ] 9.3.1 "Play the supply chain" runs the `seed.js` story in the browser in slow motion, narrating each hop.
- [ ] **9.4 Glossary**
  - [ ] 9.4.1 Terms (hash, keccak256, nonce, gas, revert, mempool, genesis, wei) underlined throughout the UI, with tooltip definitions.
- [ ] **9.5 Progress**
  - [ ] 9.5.1 Lesson completion saved in `localStorage` (wrapped in try/catch, works without it).

**Acceptance:** a newcomer can complete lessons 1–7 without outside help, and every visual event has a matching explanation.

---

## Phase 10: Testing and quality

- [ ] **10.1 Contract tests**
  - [ ] 10.1.1 `getRecords` tests (Phase 1.1.2). Keep the existing suite green.
- [ ] **10.2 Unit tests (Vitest)**
  - [ ] 10.2.1 `hashRecipe` parity with on-chain hashes (fixture).
  - [ ] 10.2.2 `verifyEngine` for all four tamper scenarios.
  - [ ] 10.2.3 `errorExplainer` for every custom error and the fallbacks.
  - [ ] 10.2.4 `storageLayout` slot maths, including packed slot 3.
  - [ ] 10.2.5 `txTracker` state transitions, including replaced and dropped.
- [ ] **10.3 End-to-end tests (Playwright)**
  - [ ] 10.3.1 Global setup starts `hardhat node`, deploys and seeds. Teardown stops it.
  - [ ] 10.3.2 Flows: hover tooltip content; register → record appears; step-mode buy; each failure scenario leaves the ledger length unchanged; tamper levels 1–3 verdicts; restore.
  - [ ] 10.3.3 Run in Demo mode (MetaMask flows are tested manually, see 10.5).
- [ ] **10.4 Accessibility and performance**
  - [ ] 10.4.1 Keyboard navigation across blocks, tooltips on focus, ARIA live region for the explanation panel, colour-blind-safe palette, reduced motion.
  - [ ] 10.4.2 Seed 1,000 records and check that scrolling stays smooth and incremental updates don't re-render the whole chain.
  - [ ] 10.4.3 Layout works at phone width: the chain strip scrolls horizontally inside its own container and the drawers become bottom sheets.
- [ ] **10.5 Manual MetaMask checklist**
  - [ ] 10.5.1 Add network 31337, import a Hardhat account, sign each action, reject a signature, restart the node and recover.

---

## Phase 11: Documentation, polish and optional testnet

- [ ] **11.1 README**
  - [ ] 11.1.1 New "Web frontend" section: install, `npm run dev`, Demo vs MetaMask, page tour with screenshots or GIFs.
  - [ ] 11.1.2 Update "Possible extensions": the web frontend item is done.
  - [ ] 11.1.3 Troubleshooting: stale MetaMask nonces, wrong chain id, contract missing after node restart.
- [ ] **11.2 Polish**
  - [ ] 11.2.1 Empty states ("No records yet: register a product to create the genesis link").
  - [ ] 11.2.2 Loading skeletons, error boundaries, copy-to-clipboard everywhere a hash or address appears.
- [ ] **11.3 Optional Sepolia deployment**
  - [ ] 11.3.1 Network config with an RPC URL and a deployer key from `.env` (already git-ignored).
  - [ ] 11.3.2 Frontend reads multiple deployments by chain id. Hide the Tamper Lab, step mode and `hardhat_*` features off-localhost.
  - [ ] 11.3.3 Static build (`vite build`) hostable on any static host.

---

## Timeline summary

Estimates assume one developer familiar with React and ethers.

| Phase | Focus | Estimate | Depends on |
|---|---|---|---|
| 0 | Decisions and repo setup | 0.5 day | — |
| 1 | Contract and dev-env groundwork | 1–1.5 days | 0 |
| 2 | Frontend scaffold | 1 day | 0 |
| 3 | Web3 connection layer | 2–3 days | 1, 2 |
| 4 | Ledger data and verification engine | 2 days | 3 |
| 5 | Chain visualization and hover | 3–4 days | 4 |
| 6 | Step-by-step pipeline | 3 days | 3, 5 |
| 7 | Failed and revoked transactions | 2–3 days | 6 |
| 8 | Tamper Lab | 3 days | 4, 5 |
| 9 | Educational layer | 3–4 days | 5–8 |
| 10 | Testing and quality | 2–3 days (plus ongoing) | all |
| 11 | Docs, polish, optional testnet | 1–2 days | all |
| | **Total** | **≈ 23–30 working days** | |

Suggested milestones:

- **M1 "See the chain"** (Phases 0–5): read-only Explorer with hover details and live updates.
- **M2 "Make transactions"** (Phases 6–7): Playground with pipeline, failures and revocations.
- **M3 "Break it"** (Phase 8): Tamper Lab.
- **M4 "Teach it"** (Phases 9–11): lessons, tests, docs.

Phases 7 and 8 can run in parallel once Phase 5 is done.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Off-chain hash doesn't match on-chain hash (encoding mismatch, for example enum as `uint8`) | Parity test over seeded records (4.2.3) before any UI depends on it |
| Storage slot of `_ledger` changes if contract inheritance or state variables change | Read slots from the compiler's `storageLayout` at deploy time (1.2.2), never hard-code them |
| `estimateGas` refuses reverting txs, so on-chain failures can't be shown | Explicit `gasLimit` on "Send anyway" (7.2.1) |
| MetaMask nonce or cache errors after restarting the Hardhat node | Restart detection (3.2.3), troubleshooting docs, Demo mode as the default |
| Users leave automine off and MetaMask txs hang | Automine indicator always visible, restored on page exit (6.4.4) |
| Users think tampering is possible on real Ethereum | Lab is local-only, permanent banner, and lesson text explains why real networks prevent it |
| Animations hide information or slow large chains | Reduced-motion mode, virtualization, animate only cards in view |
