import { ensureRecords } from "../setup";
import type { Lesson } from "../types";
import { T } from "./selectors";

export const whatIsABlock: Lesson = {
  id: "what-is-a-block", title: "What is a block?", minutes: 4,
  summary: "Every record in the ledger is a block that carries the [[hash]] of the one before it. See how.",
  setup: (env) => ensureRecords(env, 3),
  steps: [
    { id: "explorer", title: "Open the Explorer", target: T.nav, instruction: "Go to the **Explorer** page. The ledger is drawn as a row of blocks, each joined to the one before it by a link.", done: (n) => n.route === "/" },
    { id: "click", title: "Open a block", target: T.chain, instruction: "Click any block. Hovering or tabbing to one also shows a card with what it holds, which transaction created it, and whether it passed its checks.", hint: "Blocks are the cards in the row; the green arrows between them are links.", done: (n) => n.selected !== null },
    { id: "prev", title: "Find the prevHash", target: T.chain, readOnly: true, instruction: "At the bottom of a block you see two values: **prev** and **hash**. A block's [[prevhash]] is the hash of the block to its left. Compare a block's prev with its neighbour's hash: they are the same.", done: () => false },
    { id: "walk", title: "See how a hash is made", readOnly: true, instruction: "In the detail panel below the chain, step through **How is this hash made?** The fields become 32-byte words, the words are joined, and [[keccak256]] turns them into the [[hash]]. One of the fields is the prevHash, which is what links the blocks.", done: () => false },
  ],
  quiz: [
    { id: "prev", question: "What does the “prev” value inside a block hold?", choices: ["The block's own hash", "The hash of the previous block", "The price of the product", "The sender's address"], answer: 1, explanation: "Each record stores the [[hash]] of the record before it. That stored value is its [[prevhash]]." },
    { id: "change", question: "You change one field of an old record. What happens to its hash?", choices: ["Nothing", "It changes completely", "It just gets longer"], answer: 1, explanation: "A [[hash]] is a fingerprint: any change to the data gives a completely different one, so the old hash no longer fits." },
  ],
};

export const makingAChain: Lesson = {
  id: "making-a-chain", title: "Making a chain", minutes: 4,
  summary: "Register a product and watch its record link itself to the end of the chain.",
  steps: [
    { id: "actas", title: "Choose who you act as", target: T.actAs, instruction: "Pick a role in the **Act as** box at the top, for example the Manufacturer. That account will sign what you do.", done: (n) => n.actingAs !== null },
    { id: "register", title: "Register a product", target: T.actions, instruction: "On the left choose **Register a product**, give it a name and press **Send**.", hint: "The form is in the Actions panel on the left. If it is hidden, press Actions in the top bar.", done: (n, s) => n.records > s.records },
    { id: "link", title: "Watch the link form", target: T.chain, readOnly: true, instruction: "A new block slid in at the right end and a link drew itself to the block before. Its **prev** is the hash of that block, and its digits churned as its own [[hash]] was worked out.", done: () => false },
    { id: "check", title: "Check the link yourself", target: T.chain, instruction: "Click the new block, then press **Recompute now**. Your browser works out the hash itself and compares it with the stored one and with the previous block.", done: (n) => n.selected !== null },
  ],
  quiz: [
    { id: "chain", question: "What turns a list of records into a chain?", choices: ["They are stored in order", "Each record contains the hash of the one before it", "They all have the same price"], answer: 1, explanation: "Because the previous record's hash is one of the inputs to each record's own [[hash]], changing an old record breaks every link after it." },
    { id: "first", question: "What is the first record's prevHash?", choices: ["Its own hash", "32 zero bytes (the genesis hash)", "Empty"], answer: 1, explanation: "Nothing comes before the first record, so by convention its [[prevhash]] is the all-zero [[genesis]] hash." },
  ],
};

export const followingAProduct: Lesson = {
  id: "following-a-product", title: "Following a product", minutes: 4,
  summary: "Trace one product from the manufacturer to the customer through every sale, listing and reservation.",
  setup: (env) => ensureRecords(env, 5),
  steps: [
    { id: "explorer", title: "Open the Explorer", target: T.nav, instruction: "Go to the **Explorer**.", done: (n) => n.route === "/" },
    { id: "follow", title: "Follow one product", target: T.chain, instruction: "Use **Follow product** above the chain (or open a record and choose **Follow product**). Records of other products fade, but the links stay, because there is one chain for everything.", done: (n) => n.followedProduct !== null },
    { id: "story", title: "Read its story", target: T.timeline, readOnly: true, instruction: "Under the chain, the timeline tells the product's life: registered, listed, sold, and so on, with the owner after each step. A price that was later withdrawn is struck through.", done: () => false },
    { id: "step", title: "Click a step", target: T.timeline, instruction: "Click a step in the timeline. The matching block in the chain is selected.", done: (n, s) => n.selected !== null && n.selected !== s.selected },
    { id: "owner", title: "Who owns it now?", target: T.timeline, readOnly: true, instruction: "Look at the last step: the owner after it is the product's current owner. Ownership only ever changes through a **Sold** record.", done: () => false },
  ],
  quiz: [
    { id: "one", question: "Why do blocks of other products stay in the chain when you follow one product?", choices: ["They are hidden for good", "There is a single chain for all products, so links pass through them", "They belong to the same owner"], answer: 1, explanation: "The ledger is one global chain with one total order of events. Following a product only dims the rest." },
    { id: "owner", question: "How does a product's owner change?", choices: ["By listing it", "Only through a sale", "When someone reserves it"], answer: 1, explanation: "Listing, delisting and reserving never change the owner. Only a confirmed or instant sale does." },
  ],
};

