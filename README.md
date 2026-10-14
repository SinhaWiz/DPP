# Buy / Sell Traceability Simulation (Solidity)

A small Solidity project that simulates a **buy and sell marketplace** and records every action in a **hash-linked ledger**. You can trace any product from the moment it was created to its current owner, and anyone can check that the history hasn't been altered.

Everything runs on your own machine. It uses Hardhat's built-in local Ethereum network, so no real money, wallet or internet connection is needed to run it.

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
│   ├── BuySellTraceability.sol     # marketplace logic (register / list / cancel / buy)
│   ├── HashChainLedger.sol         # abstract hash-linked ledger (append + verify)
│   ├── interfaces/
│   │   ├── ITraceabilityLedger.sol # ledger types, events, errors and read API
│   │   └── IBuySellTraceability.sol# marketplace types, events, errors and API
│   └── test/
│       └── EtherRejecter.sol       # test helper: a seller that refuses ETH
├── scripts/
│   ├── simulate.js                 # runs a 4-party supply chain and prints the trail
│   └── deploy.js                   # deploys to a chosen network
├── test/
│   └── BuySellTraceability.test.js # 25 automated tests
├── hardhat.config.js               # compiler version and plugins
├── package.json                    # dependencies and npm scripts
├── .gitignore
└── README.md                       # this file
```

`artifacts/`, `cache/` and `node_modules/` are generated folders. You can delete them and regenerate them at any time.

---

## 4. Quick start: commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (once) |
| `npm run compile` | Compile the contract (`npx hardhat compile`) |
| `npm test` | Run all 25 tests |
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

### The `Record` struct

| Field | Meaning |
|---|---|
| `index` | Position in the ledger (0, 1, 2, …) |
| `timestamp` | `block.timestamp` when the record was written |
| `productId` | Which product this concerns |
| `action` | `Registered`, `Listed`, `Delisted` or `Sold` |
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

### Read functions (free, no gas when called off-chain)

| Function | Returns |
|---|---|
| `getProduct(id)` | `id`, `name`, `owner`, `price` |
| `isForSale(id)` | `true` while the product is listed |
| `getProductHistoryLength(id)` | Number of ledger records for that product |
| `getProductHistory(id, offset, limit)` | A page of that product's `Record`s, oldest first. An offset past the end gives an empty page. |
| `getRecord(index)` | A single ledger record |
| `ledgerLength()` | Number of records in the ledger |
| `verifyLedger()` | `(valid, brokenAt)` for the whole ledger |
| `verifyRange(from, to)` | `(valid, brokenAt)` for records `[from, to)`, so a long ledger can be checked in chunks |

`verifyRange` checks the first record's `prevHash` against the stored hash of the record before it. That earlier record is not re-hashed unless it falls inside the range.

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
| `RecordNotFound(index)` | `getRecord` index is past the end |
| `InvalidRange(from, to)` | `verifyRange` gets `from > to` or `to` past the end |

In JavaScript tests, check them with `expect(tx).to.be.revertedWithCustomError(contract, "NotProductOwner")`.

### Events

Each action emits an event (`ProductRegistered`, `ProductListed`, `ProductDelisted`, `ProductSold`), plus `RecordAppended` for every ledger entry. Front-ends and indexers listen to events. Reading the ledger from storage is the other way to get the data.

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

Expected result: `25 passing`.

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
- **Direct payment to the seller.** If the seller is a contract that rejects ETH, `buy()` reverts. A production marketplace often uses a pull-payment pattern (sellers withdraw their balance) to avoid this.
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
| Strange stale-build errors | `npm run clean && npm run compile` |
| `allowScripts` warnings during `npm install` | Harmless. They concern optional native builds of `keccak` and `secp256k1`, which fall back to pure JavaScript |

---

## 14. Possible extensions

- Add **roles** (Manufacturer, Distributor, Retailer) with OpenZeppelin `AccessControl`.
- Add a **pull-payment** withdrawal pattern.
- Add **product metadata** (batch number, location, an IPFS hash of a certificate).
- Add a **`transferTo(id, newOwner)`** for non-sale hand-offs such as shipping to a warehouse.
- Build a small **web front-end** (React + ethers.js) that shows the trail as a timeline.
- Deploy to a public **testnet** (Sepolia) using a faucet and an RPC provider such as Alchemy or Infura.
- Replace the linear `verifyLedger()` loop with **Merkle-tree** checkpoints so verification scales.
