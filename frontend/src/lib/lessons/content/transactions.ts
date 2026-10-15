import { addListedProduct, ensureAuto } from "../setup";
import type { Lesson } from "../types";
import { T, mined } from "./selectors";

export const aSaleStepByStep: Lesson = {
  id: "a-sale-step-by-step", title: "A sale, step by step", minutes: 6, needsLab: true,
  summary: "Switch to Step mode, buy a product, and watch the transaction wait in the [[mempool]] until you mine a block.",
  setup: addListedProduct,
  steps: [
    { id: "step-mode", title: "Switch to Step mode", target: T.mining, instruction: "In the top bar press **Step**. From now on transactions wait until you mine a block yourself.", done: (n) => n.mining === "manual" },
    { id: "actas", title: "Act as a buyer", target: T.actAs, instruction: "Choose the **Distributor** in the Act as box.", done: (n) => n.actingAs !== null },
    { id: "buy", title: "Buy the new product", target: T.actions, instruction: "Choose **Buy now**, pick the product that was just listed, and press **Send**.", hint: "It is the last product in the list, with a price next to it.", done: (n, s) => n.reached.pending > s.reached.pending },
    { id: "waiting", title: "See it waiting", target: T.dock, instruction: "Open the **Mempool** tab at the bottom. Your purchase is there, waiting. Until a block includes it, it is only a request.", done: (n) => n.pendingTxs > 0 },
    { id: "mine", title: "Mine a block", target: T.mining, instruction: "Press **Mine block**. The block includes the purchase, the contract runs, and a **Sold** record is appended.", done: (n, s) => n.pendingTxs === 0 && n.records > s.records },
    { id: "pipeline", title: "Follow it through the pipeline", target: T.dock, readOnly: true, instruction: "Open the **Transaction pipeline** tab and click each stage: draft, simulated, signed, pending, mined, record appended, verified. Each one explains what happened.", done: () => false },
    { id: "auto", title: "Back to Auto", target: T.mining, instruction: "Press **Auto** so transactions are mined immediately again.", done: (n) => n.mining === "auto" },
  ],
  quiz: [
    { id: "pending", question: "A transaction has been sent but not mined. What is it?", choices: ["Final and irreversible", "Only a request that can still be replaced or dropped", "Already recorded in the ledger"], answer: 1, explanation: "Until a block includes it, a transaction waits in the [[mempool]]. Only mined transactions are final." },
    { id: "record", question: "When does the Sold record appear?", choices: ["When you press Send", "When the transaction is mined and the contract accepts it", "When the seller is paid"], answer: 1, explanation: "The record is written by the contract while the transaction runs inside a block." },
  ],
};

export const rulesAndReverts: Lesson = {
  id: "rules-and-reverts", title: "Rules and reverts", minutes: 6, needsLab: true,
  summary: "Break the contract's rules on purpose and see why a [[revert]] costs [[gas]] but leaves no record.",
  setup: ensureAuto,
  steps: [
    { id: "open", title: "Open “Try to break the rules”", target: T.rules, readOnly: true, instruction: "In the Actions panel on the left, open **Try to break the rules**. Each button sets up a situation and then sends a call the contract must refuse.", done: () => false },
    { id: "first", title: "Break one rule", target: T.rules, instruction: "Press **Try it** on any rule, for example **Buy your own product**. It builds the situation with real transactions and then fires the failing call.", hint: "Any button labelled “Try it” works.", done: (n, s) => n.failedTxs > s.failedTxs },
    { id: "pipeline", title: "See why it failed", target: T.dock, readOnly: true, instruction: "The **Transaction pipeline** shows the call stopping at *Would fail* and, because it was sent anyway, ending in *Mined (reverted)* and *Nothing recorded*. Click each stage for the reason.", done: () => false },
    { id: "tray", title: "Find it in the Failed attempts tray", target: T.failed, readOnly: true, instruction: "On the **Explorer** page, below the chain, the failure is in the *Attempts that never reached the ledger* tray. Hover it for the reason, the fix, and the gas you paid anyway.", done: () => false },
    { id: "another", title: "Break a different rule", target: T.rules, instruction: "Try another rule, for example **Pay the wrong amount**. Notice that the chain itself did not grow.", done: (n, s) => n.failedTxs > s.failedTxs && n.records === s.records },
  ],
  quiz: [
    { id: "cost", question: "A transaction reverts. Which is true?", choices: ["It costs nothing", "It leaves a ledger record of the attempt", "It costs gas but changes nothing and leaves no record"], answer: 2, explanation: "A [[revert]] undoes every change, including the ledger entry, but the [[gas]] used up to that point is spent." },
    { id: "where", question: "Where can you still see a failed attempt?", choices: ["In the ledger", "On the Ethereum chain, in the transaction's receipt", "Nowhere"], answer: 1, explanation: "The transaction is mined in an Ethereum [[block]] with status 0, so it exists there, but it can never appear in the ledger." },
  ],
};

export const threeWaysToTakeSomethingBack: Lesson = {
  id: "three-ways-to-take-something-back", title: "Three ways to take something back", minutes: 8, needsLab: true,
  summary: "Delist a product, revoke a reservation, and cancel a pending transaction: three kinds of “undo”.",
  setup: addListedProduct,
  steps: [
    { id: "delist", title: "1. Withdraw a listing", target: T.actions, instruction: "Act as the **Manufacturer**, choose **Cancel listing**, pick the newly listed product and **Send**.", done: mined("cancelListing") },
    { id: "history", title: "The history stays", target: T.chain, readOnly: true, instruction: "A **Delisted** record was added. The earlier **Listed** record is still there: an append-only ledger never erases, it records the reversal.", done: () => false },
    { id: "relist", title: "2. Reservations: list it again", target: T.actions, instruction: "As the Manufacturer choose **List for sale** and list the same product again.", done: mined("listForSale") },
    { id: "reserve", title: "Reserve it as a buyer", target: T.actions, instruction: "Act as the **Retailer** and choose **Reserve (escrow)**. The price goes into the contract's [[escrow]] and the product is locked.", done: mined("reserve") },
    { id: "revoke", title: "Back out", target: T.actions, instruction: "Still as the Retailer choose **Cancel my reservation**. A **Revoked** record is added; the earlier **Reserved** record stays. The deposit is credited back to you.", done: mined("revokeReservation") },
    { id: "step-mode", title: "3. Pending transactions: Step mode", target: T.mining, instruction: "Press **Step** in the top bar so transactions wait.", done: (n) => n.mining === "manual" },
    { id: "send", title: "Send something", target: T.actions, instruction: "Send any transaction, for example register a product. It waits in the [[mempool]].", done: (n) => n.pendingTxs > 0 },
    { id: "cancel", title: "Cancel it before it is mined", target: T.dock, instruction: "In the **Mempool** tab press **Cancel** on your transaction. It is replaced by a 0-ETH transfer to yourself with the same [[nonce]] and a higher fee.", done: (n, s) => (n.events["tx.replaced"] ?? 0) > (s.events["tx.replaced"] ?? 0) },
    { id: "auto", title: "Mine it and go back to Auto", target: T.mining, instruction: "Press **Mine block**, then **Auto**. The original never ran, and nothing was recorded for it.", done: (n) => n.mining === "auto" && n.pendingTxs === 0 },
  ],
  quiz: [
    { id: "delist", question: "After you delist a product, what is in the ledger?", choices: ["The Listed record is deleted", "Both the Listed record and a new Delisted record", "Nothing changed"], answer: 1, explanation: "The ledger is append-only. A reversal is a new record, never an erasure." },
    { id: "cancel", question: "How does cancelling a pending transaction work?", choices: ["The node deletes it", "A new transaction with the same nonce and a higher fee replaces it", "Mining is paused for ever"], answer: 1, explanation: "Only one transaction can use a [[nonce]]. Whichever is mined first wins, and a higher fee makes the replacement win." },
    { id: "final", question: "Can you take back a transaction that has been mined?", choices: ["Yes, with Cancel", "Only by sending a new, opposite transaction", "Yes, by restarting the node"], answer: 1, explanation: "Mined transactions are final. This contract offers reversals such as revoking a reservation, but each is a new transaction." },
  ],
};

export const pushVsPullPayments: Lesson = {
  id: "push-vs-pull-payments", title: "Push versus pull payments", minutes: 6, needsLab: true,
  summary: "See why a seller that refuses ETH can block a normal sale, but not an [[escrow]] sale.",
  setup: ensureAuto,
  steps: [
    { id: "scenario", title: "Run the “Every error” scenario", target: T.rules, instruction: "Open **Try to break the rules** and press **Run the “Every error” scenario**. Among many failures it makes a sale to the Broken Wallet, a contract that refuses ETH, fail with *PaymentFailed*.", hint: "The button is at the bottom of the list of rules.", done: (n, s) => n.failedTxs >= s.failedTxs + 10 },
    { id: "pushfail", title: "Why did that sale fail?", target: T.failed, readOnly: true, instruction: "With **Buy now** the contract pushes ETH to the seller inside the same transaction. The Broken Wallet refused it, so the **whole sale was rolled back**: ownership did not change and nothing was recorded.", done: () => false },
    { id: "owed", title: "Find the money that is waiting", target: T.pull, readOnly: true, instruction: "On the Explorer, the **Money waiting to be withdrawn** section shows who is owed what. With escrow, proceeds and refunds are *credited*, not sent. The Broken Wallet is owed a refund but cannot collect it: only its own withdrawal fails, and the money stays safe.", done: () => false },
    { id: "pull", title: "Withdraw as someone who can", target: T.pull, instruction: "Press **Withdraw** for an account that is owed money. Each account pulls its own funds.", done: mined("withdraw") },
  ],
  quiz: [
    { id: "block", question: "Why can one account block a push-payment sale?", choices: ["It pays too little gas", "The payment is part of the same transaction, so if it fails everything is undone", "Sellers must approve every sale"], answer: 1, explanation: "In a push payment the transfer happens inside the sale. If the receiver refuses, the whole transaction [[revert]]s." },
    { id: "pull", question: "With a [[pullpayment|pull payment]], what can the Broken Wallet harm?", choices: ["Every other sale", "Only its own withdrawal", "The ledger"], answer: 1, explanation: "Funds are only credited. Each account collects its own, so a failure affects nobody else." },
  ],
};
