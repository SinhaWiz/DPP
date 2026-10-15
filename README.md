# Buy / Sell Traceability Simulation (Solidity)

A small Solidity project that simulates a **buy and sell marketplace** and records every action in a **hash-linked ledger**. You can trace any product from the moment it was created to its current owner, and anyone can check that the history hasn't been altered.

Everything runs on your own machine. It uses Hardhat's built-in local Ethereum network, so no real money, wallet or internet connection is needed to run it.

> **Want to see it rather than read it?** `npm run dev` starts a local chain, a backend and a web app (**Ledger Lab**) where you can watch each transaction travel step by step, make one fail, take records back, and break the chain on purpose. See [15. The visual lab](#15-the-visual-lab).

---

## Table of contents

1. [What this project demonstrates](#1-what-this-project-demonstrates)
2. [Prerequisites and installation (macOS)](#2-prerequisites-and-installation-macos)
3. [Project layout](#3-project-layout)
4. [Quick start: commands](#4-quick-start-commands)
5. [How the blockchain mechanism works](#5-how-the-blockchain-mechanism-works)
6. [Smart contract walkthrough](#6-smart-contract-walkthrough)
7. [Workflow: one product's life](#7-workflow-one-products-life)
8. [Sample output](#8-sample-output)
9. [Tamper detection](#9-tamper-detection)
10. [Tests](#10-tests)
11. [Running against a persistent local node](#11-running-against-a-persistent-local-node)
12. [Design decisions and limitations](#12-design-decisions-and-limitations)
13. [Troubleshooting](#13-troubleshooting)
14. [Possible extensions](#14-possible-extensions)
15. [The visual lab](#15-the-visual-lab) (architecture, running it, Demo vs MetaMask, page tour, API, escrow and revocation, testing)
16. [Optional: a public testnet](#16-optional-a-public-testnet)

---

## 1. What this project demonstrates

| Concept | Where it appears |
|---|---|
| **Ownership tracking** | `Product.owner` changes only through a successful `buy()` |
| **Buy / sell with payment** | `listForSale()` sets a price, `buy()` takes ETH and forwards it to the seller |
| **Traceability** | `getProductHistory(id, offset, limit)` returns a page of one product's events in order |
| **Blockchain mechanism** | Each ledger `Record` stores `prevHash` and its own `hash`, so the records form a chain |
| **Integrity verification** | `verifyLedger()` recomputes every hash and link and reports the first broken record |

Two layers of "blockchain" are involved:

- **The Ethereum chain** (Hardhat's local network) runs the contract and stores its state.
- **The hash-linked ledger** is an array inside the contract (see `HashChainLedger`). It copies the structure of a blockchain (each entry references the hash of the previous one) so the idea is visible in the code. Ethereum already gives you immutability. This ledger shows *how* that kind of chain works and lets you verify it from inside the contract.

---

## 2. Prerequisites and installation (macOS)

The commands below are for macOS (zsh) with [Homebrew](https://brew.sh).

### Required

| Tool | Why | Version used here |
|---|---|---|
| **Node.js** and **npm** | Runs Hardhat and the JavaScript tests and scripts | Node 26.5, npm 11.17 |
| **Hardhat** | Compiles Solidity, runs a local blockchain, runs tests | 2.29.x |
| **@nomicfoundation/hardhat-toolbox** | Bundle of plugins (ethers v6, chai matchers, network helpers, gas reporter, coverage) | 5.x |

The Solidity compiler (`solc` 0.8.24) is **downloaded automatically by Hardhat** on first compile. You don't install it yourself.

### Step 1: install Homebrew (skip if you already have it)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: install Node.js

```bash
brew install node
node -v    # should print v18 or newer
npm -v
```

Hardhat 2 supports Node 18, 20, 22 and later. If you hit odd errors on a very new Node release, switch to an LTS version with [nvm](https://github.com/nvm-sh/nvm):

```bash
brew install nvm
nvm install --lts
nvm use --lts
```

### Step 3: install project dependencies

From the project folder:

```bash
cd ~/Buy_sell_simulation
npm install
```

This reads `package.json` and installs Hardhat and the toolbox.

> **Setting the project up from scratch** (not needed here, since it's already done):
> ```bash
> mkdir Buy_sell_simulation && cd Buy_sell_simulation
> npm init -y
> npm install --save-dev hardhat@^2.22.0 @nomicfoundation/hardhat-toolbox@^5.0.0
> ```
> Then add `hardhat.config.js`, `contracts/`, `scripts/` and `test/`.

### Optional but helpful

- **VS Code** with the **Solidity** extension (by Nomic Foundation) for syntax highlighting and inline compile errors.
- **Git** (`brew install git`) if you want version control. The included `.gitignore` already skips `node_modules`, `artifacts` and `cache`.

---

## 3. Project layout

```
Buy_sell_simulation/
├── contracts/
│   ├── BuySellTraceability.sol     # marketplace logic (register / list / buy / escrow / revoke)
│   ├── HashChainLedger.sol         # abstract hash-linked ledger (append + verify + audit)
│   ├── interfaces/                 # types, events, errors and the read API
│   └── test/                       # test helpers: a seller that refuses ETH, a re-entering withdrawer
├── scripts/                        # simulate, deploy, seed, export ABI / fixtures, lab scenarios
├── test/                           # contract tests (Hardhat + Mocha + Chai)
├── packages/shared/                # types, hash recipe, verification engine, error explainer,
│                                   #   storage layout and the API schemas (zod) used by backend and frontend
├── backend/                        # Fastify + SQLite: indexer, transaction lifecycle, REST + WebSocket, tamper lab
├── frontend/                       # React + Vite + Tailwind: the Ledger Lab web app
├── e2e/                            # Playwright tests against a real node, backend and browser
├── docs/                           # ROADMAP.md, DESIGN_TOKENS.md, MANUAL_TESTING.md, openapi.json
├── .github/workflows/ci.yml        # the checks that run on every push
├── hardhat.config.js
└── package.json                    # npm workspaces and scripts
```

`artifacts/`, `cache/` and `node_modules/` are generated folders. You can delete them and regenerate them at any time.

---

## 4. Quick start: commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (once) |
| `npm run compile` | Compile the contract (`npx hardhat compile`) |
| `npm test` | Run the contract tests (90) |
| `npm run test:all` | Contract, shared and backend tests |
| `npm run dev` | Start everything for the visual lab (see [section 15](#15-the-visual-lab)) |
| `npm run test:e2e` | Browser tests against a real stack |
| `npm run coverage` | Contract coverage |
| `npm run simulate` | Run the full buy/sell scenario and print the traceability trail |
| `npm run node` | Start a persistent local blockchain on `http://127.0.0.1:8545` |
| `npm run deploy` | Deploy to that local node (needs `npm run node` running in another terminal) |
| `npm run clean` | Delete `artifacts/` and `cache/` |

The fastest way to see it work:

```bash
npm install
npm test
npm run simulate
```

---

## 5. How the blockchain mechanism works

### The idea

A blockchain is a list of records where each record includes a **fingerprint (hash) of the record before it**. A hash function such as `keccak256` turns any input into a fixed 32-byte value. Change one bit of the input and the hash changes completely.

```
┌─────────────── Record #0 ───────────────┐
│ action: Registered   product: 1         │
│ prevHash: 0x000…000   (genesis)         │
│ hash = keccak256(all fields above)  ─┐  │
└──────────────────────────────────────┼──┘
                                       │
┌─────────────── Record #1 ────────────┼──┐
│ action: Listed       product: 1      │  │
│ prevHash: ◄──────────────────────────┘  │
│ hash = keccak256(all fields above)  ─┐  │
└──────────────────────────────────────┼──┘
                                       │
┌─────────────── Record #2 ────────────┼──┐
│ action: Sold         product: 1      │  │
│ prevHash: ◄──────────────────────────┘  │
│ hash = keccak256(all fields above)      │
└─────────────────────────────────────────┘
```

### Why tampering is detectable

Suppose someone changes the price in Record #2:

1. Record #2's stored `hash` no longer matches the hash recomputed from its (now different) fields. **Mismatch found.**
2. If they also recompute Record #2's hash, Record #3's `prevHash` no longer matches it. **The link is broken.**
3. To hide the change they would have to rewrite every later record, and on a real network they would also have to rewrite every block that contains those transactions.

### What goes into each hash

```solidity
keccak256(abi.encode(index, timestamp, productId, action, actor, counterparty, price, prevHash))
```

`prevHash` is part of the hashed data. That is what makes it a chain and not just a list.

### Two witnesses: storage and logs

Every record exists in two places:

1. **Contract storage**: the `Record` in the `_ledger` array. `verifyLedger()` checks this copy.
2. **The transaction log**: the `RecordAppended` event, emitted in the same transaction.

The event carries both halves of the link: `RecordAppended(index, productId, action, actor, prevHash, hash)`. `index`, `productId` and `actor` are indexed, so you can filter by them. (In ethers, filter arguments are positional over *all* parameters, with `null` for the ones you skip: `c.filters.RecordAppended(null, null, null, someActor)`.)

Logs are written once and cannot be changed afterwards, so they are an independent witness. If storage is rewritten so that it still verifies (see §9), the log still holds the original hashes, and the two copies no longer agree. Emitting the extra fields costs a few hundred more gas per record.

### The `Record` struct

| Field | Meaning |
|---|---|
| `index` | Position in the ledger (0, 1, 2, …) |
| `timestamp` | `block.timestamp` when the record was written |
| `productId` | Which product this concerns |
| `action` | `Registered`, `Listed`, `Delisted`, `Sold`, `Reserved` or `Revoked` |
| `actor` | Who performed the action (the seller for a sale) |
| `counterparty` | The buyer for a sale, `address(0)` for every other action |
| `price` | Price in wei (0 when not applicable) |
| `prevHash` | Hash of the previous record (`GENESIS_HASH`, i.e. `0x00…00`, for the first) |
| `hash` | Hash of all the fields above |

---

## 6. Smart contract walkthrough

### Structure

The contract is split by responsibility:

| File | Responsibility |
|---|---|
| [contracts/interfaces/ITraceabilityLedger.sol](contracts/interfaces/ITraceabilityLedger.sol) | Ledger types (`Action`, `Record`), the `RecordAppended` event, ledger errors and the ledger read API |
| [contracts/interfaces/IBuySellTraceability.sol](contracts/interfaces/IBuySellTraceability.sol) | Marketplace types (`Product`), events, errors and public API. Extends the ledger interface. |
| [contracts/HashChainLedger.sol](contracts/HashChainLedger.sol) | The "blockchain": append a record, link it to the previous hash, verify the chain, page through a product's history. Knows nothing about buying or selling. |
| [contracts/BuySellTraceability.sol](contracts/BuySellTraceability.sol) | The marketplace rules: who may register, list, cancel and buy. Appends to the ledger after each action. |

```
ITraceabilityLedger ◄────────── IBuySellTraceability
        ▲                                ▲
        │                                │
 HashChainLedger ◄──────── BuySellTraceability
 (abstract: the chain)        (the marketplace)
```

### State

```solidity
// HashChainLedger
Record[] private _ledger;                                    // the global hash chain
mapping(uint256 productId => uint256[]) private _indexesByProduct; // product → positions in _ledger

// BuySellTraceability
uint256 public productCount;                                 // also the latest product id
mapping(uint256 productId => Product) private _products;
mapping(uint256 productId => Reservation) private _reservations;  // escrow deposits
mapping(address => uint256) public pendingWithdrawals;             // ETH owed to accounts
```

The ledger is **global**: all products share one chain, which gives a single total order of events. `_indexesByProduct` is an index so a single product's history can be read without scanning everything.

A product is **for sale exactly when `price > 0`**. There is no separate flag that could disagree with the price.

### Write functions

| Function | Who can call | What it does | Ledger action |
|---|---|---|---|
| `registerProduct(name)` | anyone | Creates a product. The caller becomes the owner. | `Registered` |
| `listForSale(id, price)` | current owner | Lists the product at `price` wei (must be > 0). Calling it again changes the price. | `Listed` |
| `cancelListing(id)` | current owner | Removes the listing. | `Delisted` |
| `buy(id)` (payable) | anyone except the owner | Pays exactly the price, takes ownership, and the seller receives the ETH. | `Sold` |
| `reserve(id)` (payable) | anyone except the owner | Deposits exactly the price into escrow and locks the product. See [Escrow purchases](#escrow-purchases-reserve-confirm-revoke). | `Reserved` |
| `confirmSale(id)` | current owner | Accepts the reservation (before it expires): ownership moves to the buyer, the payment becomes withdrawable by the seller. | `Sold` |
| `revokeReservation(id)` | the reserving buyer | Cancels. The deposit becomes withdrawable by the buyer. | `Revoked` |
| `rejectReservation(id)` | current owner | Declines. The deposit becomes withdrawable by the buyer. | `Revoked` |
| `expireReservation(id)` | anyone, after the period | Ends a reservation older than `RESERVATION_PERIOD` (1 day). | `Revoked` |
| `withdraw()` | anyone with a balance | Pulls the caller's `pendingWithdrawals` (sale proceeds or refunds). | none: money moves, no product changes |

While a product is reserved, `listForSale`, `cancelListing`, `buy` and `reserve` revert with `ProductReserved`.

### Escrow purchases (reserve, confirm, revoke)

Instant `buy()` is atomic: payment and ownership change happen together and cannot be undone. The escrow flow splits a purchase into steps, so a purchase can be **revoked after money has moved**.

```
            reserve(id) + ETH
 Listed ──────────────────────────► Reserved  (product locked, ETH held by the contract)
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        │ confirmSale (seller)        │ revokeReservation (buyer)    │ expireReservation (anyone,
        ▼                             │ rejectReservation (seller)   │   after 1 day)
      Sold                            ▼                              ▼
 (seller can withdraw)            Revoked ◄──────────────────────────┘
                                  (buyer can withdraw the refund; product is Listed again)
```

Each step appends a ledger record. A revoked purchase is **not erased**; it stays in the trail as `Reserved` followed by `Revoked`. Append-only ledgers don't delete, they record the reversal.

| Record | `actor` | `counterparty` | `price` |
|---|---|---|---|
| `Reserved` | the buyer | the seller | the deposit |
| `Sold` (via `confirmSale`) | the seller | the buyer | the payment |
| `Revoked` | whoever ended it (buyer, seller, or any caller after expiry) | the other party (the seller if the buyer revoked, otherwise the buyer) | the refunded deposit |

**Push vs pull payments.** `buy()` *pushes* ETH to the seller inside the same transaction, so a seller that cannot receive ETH makes the whole sale revert with `PaymentFailed`. The escrow flow *pulls*: it only credits `pendingWithdrawals`, and each party calls `withdraw()` themselves. An account that can't receive ETH can only hurt itself: its `withdraw()` fails with `WithdrawFailed`, its credit stays safe, and nobody else is blocked. `withdraw()` zeroes the balance before sending, so a receiver that re-enters finds nothing left to take.

### Gas costs

Measured with `REPORT_GAS=true npx hardhat test` (average per call, including the ledger write):

| Function | Gas |
|---|---|
| `registerProduct` | ≈ 268,000 |
| `listForSale` | ≈ 244,000 |
| `cancelListing` | ≈ 206,000 |
| `buy` | ≈ 260,000 |
| `reserve` | ≈ 314,000 |
| `confirmSale` | ≈ 274,000 |
| `revokeReservation` / `rejectReservation` / `expireReservation` | ≈ 268,000 |
| `withdraw` | ≈ 30,000 |

Almost all of it is writing the 8-slot `Record` (plus one index slot) to storage. `withdraw` writes no record, which is why it is cheap.

### Read functions (free, no gas when called off-chain)

| Function | Returns |
|---|---|
| `getProduct(id)` | `id`, `name`, `owner`, `price` |
| `isForSale(id)` | `true` while the product is listed |
| `getProductHistoryLength(id)` | Number of ledger records for that product |
| `getProductHistory(id, offset, limit)` | A page of that product's `Record`s, oldest first. An offset past the end gives an empty page. |
| `getProducts(offset, limit)` | A page of products in id order (offset 0 starts at product #1). Clamped, never reverts on a large offset or limit. |
| `getRecord(index)` | A single ledger record |
| `getRecords(offset, limit)` | A page of the global ledger, oldest first. One call instead of one per record. |
| `ledgerLength()` | Number of records in the ledger |
| `headHash()` | Hash of the newest record (all zeros when empty). This is the `prevHash` the next record will carry. |
| `verifyLedger()` | `(valid, brokenAt)` for the whole ledger |
| `verifyRange(from, to)` | `(valid, brokenAt)` for records `[from, to)`, so a long ledger can be checked in chunks |
| `inspectRecord(index)` | One record plus its recomputed hash, the hash it should link to, and separate `dataOk` / `linkOk` flags |
| `auditRange(from, to)` | `(brokenIndexes, reasons)` for **every** broken record in `[from, to)`. `reasons` is a bitmask: `1` = data mismatch, `2` = link mismatch |

`verifyRange` checks the first record's `prevHash` against the stored hash of the record before it. That earlier record is not re-hashed unless it falls inside the range.

#### Why `verifyLedger` reports only the first break

`verifyLedger` and `verifyRange` stop at the first bad record and return only its index. They can't tell you *why* it is bad, or whether more records are bad. That is enough to answer "is the ledger intact?" and keeps the loop cheap.

`inspectRecord` and `auditRange` use the same per-record check, so they always agree with `verifyLedger` about *which* record fails first. They go further:

- `inspectRecord` says whether the record's **data** no longer matches its hash, or its **link** no longer matches the previous hash.
- `auditRange` lists all broken records at once, each with a reason.

The two reasons show up differently depending on the attack. If someone changes a record's data without touching its stored hash, only that record is flagged (`dataOk = false`); the next record's link still matches the stored hash, so it is not flagged. If they also rewrite the stored hash to match, that record looks fine, but the **next** record's link breaks. This is why an attacker has to rewrite every later record to hide a change, and why the in-contract check alone cannot detect a complete rewrite (see the Tamper Lab in `docs/ROADMAP.md`).

Keep `auditRange` calls to a few hundred records. The loop runs inside a single `eth_call`, which has a gas cap.

### Custom errors

Failures use typed custom errors instead of revert strings. They are cheaper in gas and carry data.

| Error | Raised when |
|---|---|
| `EmptyName()` | `registerProduct` gets an empty name |
| `InvalidPrice()` | `listForSale` gets a price of 0 |
| `ProductNotFound(productId)` | The id was never registered |
| `NotProductOwner(productId, caller)` | A non-owner tries to list or cancel |
| `NotListed(productId)` | Cancelling or buying a product that isn't listed |
| `CannotBuyOwnProduct(productId)` | The owner tries to buy their own product |
| `IncorrectPayment(expected, sent)` | `msg.value` differs from the price |
| `PaymentFailed(recipient)` | The seller's address rejected the ETH. The whole sale reverts. |
| `ProductReserved(productId)` | Listing, delisting, buying or reserving a product that already has a reservation |
| `NotReserved(productId)` | Confirming, revoking, rejecting or expiring a product with no reservation |
| `NotReservationBuyer(productId, caller)` | Someone other than the reserving buyer calls `revokeReservation` |
| `ReservationExpired(productId, expiredAt)` | The seller tries to confirm after the period ended |
| `ReservationNotExpired(productId, expiresAt)` | Expiring a reservation before its period ended |
| `NothingToWithdraw(account)` | `withdraw` with a zero balance |
| `WithdrawFailed(account)` | The caller is a contract that rejected the ETH. The balance is kept. |
| `RecordNotFound(index)` | `getRecord` index is past the end |
| `InvalidRange(from, to)` | `verifyRange` or `auditRange` gets `from > to` or `to` past the end |

In JavaScript tests, check them with `expect(tx).to.be.revertedWithCustomError(contract, "NotProductOwner")`.

### Events

Each action emits an event (`ProductRegistered`, `ProductListed`, `ProductDelisted`, `ProductSold`, and for escrow `ReservationCreated`, `SaleConfirmed`, `ReservationRevoked` and `Withdrawn`), plus `RecordAppended` for every ledger entry. Front-ends and indexers listen to events. Reading the ledger from storage is the other way to get the data.

### Code organisation notes

- `buy()` reads as a short sequence: find the product, `_requirePurchasable`, `_transferOwnership`, append the record, `_pay`.
- `onlyProductOwner` and the internal `_product(id)` are the only places that check that a product exists and who owns it.
- `GENESIS_HASH` is a named constant for "no previous record".
- Every external function has NatSpec, inherited from the interfaces with `@inheritdoc`.

### Security notes

- **Checks-effects-interactions** in `buy()`: ownership, listing state and the ledger record are all updated *before* ETH is sent to the seller, which prevents re-entrancy attacks.
- **Exact payment** is required, so there is no refund logic and no overpayment to lose.
- Solidity 0.8.x has built-in overflow checks.

---

## 7. Workflow: one product's life

The simulation uses four accounts that Hardhat creates for you:

| Role | Hardhat account |
|---|---|
| Manufacturer | #0 |
| Distributor | #1 |
| Retailer | #2 |
| Customer | #3 |

```
Manufacturer        Distributor          Retailer            Customer
     │                   │                   │                   │
     │ registerProduct("Laptop")             │                   │
     │──► Record #0 Registered               │                   │
     │ listForSale(1, 1.0 ETH)               │                   │
     │──► Record #1 Listed                   │                   │
     │                   │ buy(1) + 1.0 ETH  │                   │
     │◄── 1.0 ETH ───────│                   │                   │
     │       Record #2 Sold (Mfr → Dist)     │                   │
     │                   │ listForSale(1, 1.5 ETH)               │
     │                   │──► Record #3 Listed                   │
     │                   │                   │ buy(1) + 1.5 ETH  │
     │                   │◄── 1.5 ETH ───────│                   │
     │                   │   Record #4 Sold (Dist → Ret)         │
     │                   │                   │ listForSale(1, 2.0 ETH)
     │                   │                   │──► Record #5 Listed
     │                   │                   │                   │ buy(1) + 2.0 ETH
     │                   │                   │◄── 2.0 ETH ───────│
     │                   │      Record #6 Sold (Ret → Customer)  │
     │                                                           │
     └──────────── verifyLedger() → (true, 0) ◄──────────────────┘
```

### Step by step for a single sale

1. **List.** The owner calls `listForSale(id, price)`. The contract checks ownership and price, sets the price, appends a `Listed` record and emits `ProductListed`.
2. **Buy.** A buyer calls `buy(id)` with `value = price`. The contract:
   1. Checks that the product is listed, that the buyer isn't the owner, and that the payment is exact.
   2. **Effects:** sets the new owner, clears the listing, and appends a `Sold` record (`actor` = seller, `counterparty` = buyer, `price`).
   3. **Interaction:** forwards the ETH to the seller.
3. **Trace.** Anyone calls `getProductHistory(id, offset, limit)` to read the trail (page by page if it is long), and `verifyLedger()` to confirm nothing was altered.

If any check fails, the whole transaction reverts. No state changes, no record is written and no ETH moves.

---

## 8. Sample output

`npm run simulate` prints (hashes and timestamps will differ on each run):

```
Contract deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3

▶ Manufacturer registers 'Laptop'
▶ Manufacturer lists for 1.0 ETH, Distributor buys
▶ Distributor lists for 1.5 ETH, Retailer buys
▶ Retailer lists for 2.0 ETH, Customer buys

══════════════ Traceability trail for product #1 ══════════════
Product: Laptop | current owner: Customer (0x90F79b…)

Block #0  [Registered]  2026-10-11T01:04:04.000Z
  actor        : Manufacturer (0xf39Fd6…)
  counterparty : —
  price        : 0.0 ETH
  prevHash     : 0x0000000000000000000000000000000000000000000000000000000000000000
  hash         : 0xb678222437b35b4f6cb714e87981c752da60191c4a01b16870e754b37f81f13a

Block #1  [Listed]  ...
  prevHash     : 0xb678222437b35b4f6cb714e87981c752da60191c4a01b16870e754b37f81f13a   ← equals Block #0's hash
  hash         : 0x3d60b0bb44f775b8b9e3a9093da5ee965dd039eddef398bb03bf266490de213e

...

✔ Ledger integrity verified: all hashes and links are intact.
```

Note how each block's `prevHash` equals the previous block's `hash`.

---

## 9. Tamper detection

The test `verifyLedger detects tampering with a stored record` simulates an attacker. It uses Hardhat's `hardhat_setStorageAt` cheat code (available only on a local test network) to overwrite the `price` of Record #2 directly in contract storage. Then it calls `verifyLedger()`:

```
valid    = false
brokenAt = 2
```

On a real network this kind of direct storage edit is impossible. The test exists to show what the verification logic would catch if a record ever did differ from its hash.

The test also recomputes a record's hash **off-chain** in JavaScript with `ethers.keccak256(...)` and checks that it matches the on-chain `hash`. That is how an outside auditor would verify the trail without trusting the contract's own `verifyLedger()`.

---

## 10. Tests

```bash
npm test
```

| Group | What is checked |
|---|---|
| Register / list / cancel | Ownership on registration, empty-name rejection, owner-only listing, price > 0, `isForSale`, cancel flow, unknown product ids |
| Buy | ETH moves buyer → seller exactly, ownership transfers, wrong payment / self-purchase / unlisted purchases revert with the right custom error, the previous owner loses control, a seller that refuses ETH reverts the whole sale |
| Traceability | Full ordered trail across 4 parties, `actor` / `counterparty` semantics, `prevHash` linking, off-chain hash recomputation, `verifyLedger` on an intact chain, tamper detection, separate trails per product, unknown ids and indexes |
| Pagination | Windowed reads, last page clamped, empty page past the end, huge `limit` doesn't overflow |
| `verifyRange` | Intact sub-ranges (including a mid-chain start and an empty range), tampering found only inside the checked range, invalid ranges rejected |

Expected result: `90 passing`.

The other layers have their own suites (see [section 15.7](#157-testing)).

Optional extras provided by the toolbox:

```bash
REPORT_GAS=true npx hardhat test     # gas usage per function
npx hardhat coverage                 # line / branch coverage
```

---

## 11. Running against a persistent local node

`npm run simulate` and `npm test` use a temporary in-memory network that disappears when the command ends. To keep a chain running and interact with it:

**Terminal 1**: start the node. It prints 20 test accounts with their private keys. Those keys are public and are for local testing only.

```bash
npm run node
```

**Terminal 2**: deploy:

```bash
npm run deploy
# BuySellTraceability deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

**Terminal 2**: explore interactively with the Hardhat console:

```bash
npx hardhat console --network localhost
```

```js
const [mfr, dist] = await ethers.getSigners();
const c = await ethers.getContractAt("BuySellTraceability", "0x5FbDB2315678afecb367f032d93F642f64180aa3");

await c.connect(mfr).registerProduct("Phone");
await c.connect(mfr).listForSale(1, ethers.parseEther("2"));
await c.connect(dist).buy(1, { value: ethers.parseEther("2") });

await c.getProductHistory(1, 0, 100);
await c.verifyLedger();
```

Stop the node with `Ctrl+C`. Restarting it resets the chain.

---

## 12. Design decisions and limitations

- **One global chain, not one per product.** It is simpler and gives a total ordering of events. The cost is that `verifyLedger()` loops over the whole ledger, so its gas cost grows with the ledger length. It is a `view` function, so calling it off-chain is free, but another contract calling it on-chain would pay for the loop. For long ledgers, use `verifyRange(from, to)` and `getProductHistory(id, offset, limit)` to work in chunks.
- **The in-contract hash chain is redundant on a real blockchain.** Ethereum already makes history tamper-evident. The chain here is included to demonstrate the mechanism and to give a self-contained verification function. For production tracing you would usually rely on events plus an indexer.
- **Direct payment to the seller in `buy()`.** If the seller is a contract that rejects ETH, `buy()` reverts. It is kept this way on purpose, to show push payments. The escrow flow (`reserve` / `confirmSale` / `withdraw`) uses the pull-payment pattern instead.
- **A reservation locks the product.** A malicious buyer can reserve a product and then do nothing, blocking other buyers until the period (1 day) ends or the seller rejects. A real marketplace would add a deposit penalty or rate limits.
- **No access control for who may register products.** Anyone can. A real supply chain would restrict this with roles (for example OpenZeppelin `AccessControl`).
- **No physical-world proof.** The contract records what accounts *claim*. It can't know that a physical laptop was really handed over.
- **Prices are in wei** (1 ETH = 10¹⁸ wei). The scripts convert with `ethers.parseEther` and `ethers.formatEther`.
- **No product deletion or transfer-without-sale.** Ownership changes only through `buy()`.

---

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: npm` | Install Node: `brew install node`, then open a new terminal |
| `Cannot find module 'hardhat'` | Run `npm install` in the project folder |
| `Hardhat 3 migration error: require is not defined in ES module scope` | The project targets **Hardhat 2** (CommonJS). Running `npx hardhat --init` or `npm install hardhat@latest` installs Hardhat 3 and adds `"type": "module"`. Fix: `npm pkg set type=commonjs && npm install --save-dev hardhat@^2.22.0 @nomicfoundation/hardhat-toolbox@^5.0.0` |
| Compiler download fails | `solc` is fetched on first compile and needs internet once. Retry, or check proxy/VPN settings |
| Warning about an unsupported Node version | Use an LTS release: `nvm install --lts && nvm use --lts` |
| `npm run deploy` fails with a connection error | Start the node first with `npm run node` in another terminal |
| Port 8545 already in use | Stop the other process: `lsof -i :8545`, then `kill <PID>` |
| `npm audit` reports vulnerabilities | They come from dev tooling in Hardhat's dependency tree. Nothing here is deployed to production, so they can be ignored for this simulation |
| Failed transactions throw an error instead of showing up as failed | The node must be started with `DEV_NODE=1` (`npm run dev:node` does this). Without it Hardhat refuses to mine reverting transactions, so there is nothing to show |
| MetaMask says the nonce is too high or a transaction never confirms after restarting the node | The chain restarted but MetaMask remembers the old one. MetaMask → Settings → Advanced → *Clear activity tab data* |
| The page says wrong network | Switch MetaMask to "Hardhat Local" (chain id 31337, `http://127.0.0.1:8545`) |
| The page says the contract is missing after a restart | A restarted node starts empty. Run `npm run dev:deploy` and `npm run dev:seed`; the page recovers on its own |
| The backend refuses to start with an `node:sqlite` error | It needs a recent Node (24 or newer); check `node -v` |
| The page says "Backend offline: read-only view" | Start the backend (`npm run dev:backend`). Reading the chain and checking it in the browser keep working without it |
| Strange stale-build errors | `npm run clean && npm run compile` |
| `allowScripts` warnings during `npm install` | Harmless. They concern optional native builds of `keccak` and `secp256k1`, which fall back to pure JavaScript |

---

## 14. Possible extensions

- Add **roles** (Manufacturer, Distributor, Retailer) with OpenZeppelin `AccessControl`.
- Add **product metadata** (batch number, location, an IPFS hash of a certificate).
- Add a **`transferTo(id, newOwner)`** for non-sale hand-offs such as shipping to a warehouse.
- ~~Build a small web front-end that shows the trail as a timeline.~~ Done: see [15. The visual lab](#15-the-visual-lab).
- ~~Pull payments for sales.~~ Done: the escrow flow pays through `withdraw()`.
- Deploy to a public **testnet** (Sepolia) using a faucet and an RPC provider such as Alchemy or Infura.
- Replace the linear `verifyLedger()` loop with **Merkle-tree** checkpoints so verification scales.

---

## 15. The visual lab

A web app on top of the same contract, made for learning: every transaction can be followed from the form to the ledger, and the chain can be broken on purpose to see how that is noticed.

### 15.1 Architecture

```
 browser (React)  ──REST + WebSocket──▶  backend (Fastify)  ──JSON-RPC──▶  Hardhat node
   │   │                                   │  indexer → SQLite                  ▲
   │   └── reads the node directly         │  transaction lifecycle             │
   │       when the backend is down        │  tamper lab (dev node only)        │
   └── signs transactions itself (demo accounts or MetaMask) ───────────────────┘
```

- The **backend never signs for users**. It reads the chain, follows each transaction from pending to verified, and runs the lab (tampering, mining control, scenarios). Its history lives in SQLite and can always be rebuilt from the node.
- The **frontend** signs with built-in demo accounts or MetaMask, and can read the node directly, so a read-only view still works if the backend is stopped.
- **Shared code** (`packages/shared`) holds the hash recipe and verification engine used by the contract tests, the backend and the browser, so all three always agree on what "intact" means.

### 15.2 Running it

```bash
npm install
npm run dev          # node, deploy, seed, backend and web app together
```

Open http://127.0.0.1:5173. To run the pieces separately: `npm run dev:node`, `npm run dev:deploy`, `npm run dev:seed`, `npm run dev:backend`, `npm run dev:web`.

Backend settings are environment variables (all optional): `RPC_URL`, `PORT` (4000), `HOST` (127.0.0.1), `DB_PATH`, `DEPLOYMENT_PATH`, `POLL_MS`, `CORS_ORIGINS`, `LAB_GRACE_MS`, `LOG_LEVEL`.

### 15.3 Demo accounts vs MetaMask

Use **Act as** in the top bar.

- **Demo accounts** (Manufacturer, Distributor, Retailer, Customer, Outsider) are the node's pre-funded test accounts. Transactions are signed in the page, with no extension and no prompts, which makes experiments quick.
- **MetaMask** signs with your own wallet on the local network (the page offers to add "Hardhat Local", chain id 31337). Use it to see what a real signing flow looks like, including rejecting a request. The checklist in [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) covers it.

### 15.4 A tour of the pages

| Page | What you do there |
|---|---|
| **Explorer** | The ledger as a chain of blocks. Hover or focus a block to see its record, the transaction behind it and each integrity check with the reason. Filter by product, follow one product's timeline, see escrow and pull payments. |
| **Playground** | One workspace: choose a role and an action, see a prediction of what the contract will say, send it, and watch the transaction pipeline (draft → simulated → signed → pending → mined → recorded → verified) next to the chain, the mempool and the activity feed. Switch to **Step** mode to hold transactions until you press **Mine block**. |
| **Storage** | Where a record lives: its eight storage slots, how the packed slot is laid out, what writing it cost, and three independent ways to read it back. |
| **Tamper Lab** | Four attack levels from changing one field to rewriting the whole tail, a prediction before each run, and a table of which check noticed (contract, event log, your browser). Every attack can be undone. Only available on the local dev node. |
| **Learn** | Nine short lessons and a story replay (a laptop travels from manufacturer to customer in nine real transactions). The side panel explains what is happening in plain words; terms in the text have hover definitions. |

Screenshots and animated captures are not included in the repository; run the app to see the pages.

### 15.5 API overview

The backend serves a JSON API and a WebSocket (`/ws`) that pushes changes as they happen. The full contract is in [`docs/openapi.json`](docs/openapi.json) (OpenAPI 3.1, generated from the same zod schemas the code validates with: `npm run export:openapi`). Groups: session and health, records and products, transactions and blocks, verification, storage, and `/api/lab/*` (tamper, undo, mining mode, scenarios), which refuses to run unless the node is a local dev node.

### 15.6 Escrow and the three ways to take something back

A buyer can `reserve` a product, paying into escrow. The product is locked, and the money is held by the contract rather than paid to the seller. Then one of three things happens, and each one is recorded:

1. The **seller confirms** (`confirmSale`): ownership transfers and the seller can `withdraw` the payment (a pull payment).
2. The **seller rejects** (`rejectReservation`): the buyer's payment is returned to their withdrawable balance and the product is unlocked.
3. The **buyer cancels**, or **anyone revokes after the reservation expires**: same outcome, a *Revoked* record.

The lessons "three ways to take something back" and "push vs pull payments" walk through these with real transactions, and the Playground can try each of them.

### 15.7 Testing

| Layer | Command | What it covers |
|---|---|---|
| Contracts | `npm test`, `npm run coverage` | 90 tests; escrow, ledger, tampering, events |
| Shared | `npm test -w @dpp/shared` | hash recipe parity with the contract, verification, error explanation, storage layout |
| Backend | `npm test -w @dpp/backend` | indexer, lifecycle, API, lab, reorgs, restarts (real Hardhat nodes) |
| Frontend | `npm test -w @dpp/frontend` | components, stores and the lessons played by scripted learners |
| End to end | `npm run test:e2e` | a real browser against a real node, backend and web server: the main flows, accessibility (axe, both themes), phone width, a 1,200-record ledger |

`npm run test:e2e` needs the browser once: `npm run install:browsers -w @dpp/e2e`. Continuous integration (`.github/workflows/ci.yml`) runs all of this on every push.

---

## 16. Optional: a public testnet

The contract and the indexer are not tied to the local node. For Sepolia you need an RPC URL and a funded deployer key. Copy `.env.example` to `.env` (git-ignored) and fill it in:

```
SEPOLIA_RPC_URL=https://...
DEPLOYER_PRIVATE_KEY=0x...
```

```bash
WRITE_DEPLOYMENT=1 npx hardhat run scripts/deploy.js --network sepolia
RPC_URL=$SEPOLIA_RPC_URL npm run dev:backend
npm run dev:web
```

What changes away from the local node:

- The **lab is switched off**: the backend refuses it unless the node is the local dev chain (31337) and the API is bound to a loopback address. The Tamper Lab page explains why, and the mining controls are replaced by a note.
- **Tracing**: most hosted RPCs do not offer `debug_traceTransaction`. The backend notices and explains a failed transaction by re-running the call at the parent block instead, which is close but not exact when earlier transactions in the same block changed the state. Storage-write costs are not available without tracing.
- Blocks take seconds, so a transaction really does wait in the mempool; use a demo-account-free setup (MetaMask on Sepolia) since the demo accounts have no funds there.

Never put a key that holds real funds in a project you share.
