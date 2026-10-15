export interface GlossaryEntry {
  id: string;
  term: string;
  /** One sentence for the tooltip. */
  short: string;
  /** A fuller explanation for the glossary page. */
  long: string;
}

/** Words a newcomer meets in this app. Keep each short enough to read in a tooltip. */
export const GLOSSARY: GlossaryEntry[] = [
  { id: "hash", term: "hash", short: "A fixed-size fingerprint of some data. Change the data even slightly and the fingerprint changes completely.", long: "A hash function turns any amount of data into a short, fixed-size value. The same input always gives the same hash, but you cannot work backwards from a hash to the data, and two different inputs essentially never share a hash." },
  { id: "keccak256", term: "keccak256", short: "The hash function Ethereum uses (the basis of SHA-3).", long: "keccak256 produces a 32-byte hash. Ethereum uses it for addresses, function selectors, storage slots and, here, for the hash of every ledger record." },
  { id: "prevhash", term: "prevHash", short: "The hash of the previous record, stored inside the next one. This is what makes a list of records a chain.", long: "Because prevHash is one of the inputs to a record's own hash, changing an old record changes its hash, which no longer matches the prevHash stored in the next record." },
  { id: "genesis", term: "genesis", short: "The start of a chain. The first record's prevHash is all zeros because nothing came before it.", long: "Every record stores the hash of the one before it, but the very first record has nothing before it. By convention its prevHash is 32 zero bytes, the genesis hash. The same word is used for an Ethereum chain's first block, which is block 0." },
  { id: "block", term: "block", short: "A batch of transactions that the network adds to the Ethereum chain together. (A ledger record is not an Ethereum block.)", long: "There are two chains in this app: Ethereum's chain of blocks, and the ledger's chain of records inside the contract. A transaction lives in an Ethereum block; the record it creates lives in the ledger." },
  { id: "ledger", term: "ledger", short: "The contract's append-only list of records, each linked to the one before it.", long: "Records are only ever added at the end. Reversals (like a revoked reservation) are new records, never edits." },
  { id: "record", term: "record", short: "One entry of the ledger: who did what to which product, when, and its hash.", long: "A record has an index, timestamp, product id, action, actor, counterparty, price, prevHash and its own hash." },
  { id: "nonce", term: "nonce", short: "A counter of how many transactions an account has sent. Each transaction uses the next number, so none can run twice.", long: "If two transactions from one account share a nonce, only one can ever be mined. That is how a pending transaction can be replaced or cancelled: send another with the same nonce and a higher fee." },
  { id: "gas", term: "gas", short: "The fee for the computing and storage a transaction uses. You pay for the gas even if the transaction fails.", long: "Each EVM step has a gas cost. Writing a new storage slot costs the most. A transaction that runs out of gas, or reverts, still pays for what it used." },
  { id: "revert", term: "revert", short: "The contract stops and undoes every change the transaction made. You still pay for the gas.", long: "A revert comes with an error that says why. Because everything is undone, a reverted transaction never leaves a ledger record." },
  { id: "mempool", term: "mempool", short: "Where sent transactions wait until a block includes them.", long: "Until it is mined, a transaction is only a request: it can be replaced by another with the same nonce, or dropped." },
  { id: "wei", term: "wei", short: "The smallest unit of ether. 1 ETH = 1,000,000,000,000,000,000 wei.", long: "Contracts work in wei so they never need fractions. The app shows ETH and keeps the exact wei in a tooltip." },
  { id: "escrow", term: "escrow", short: "Money held by the contract between buyer and seller until the deal is settled.", long: "In the reservation flow the buyer's deposit is locked in the contract. The seller confirming releases it to the seller; anything else returns it to the buyer." },
  { id: "slot", term: "storage slot", short: "A 32-byte cell of a contract's permanent storage.", long: "A contract's state lives in numbered slots. A record uses eight of them; small fields such as the action and the actor can share one." },
  { id: "eventlog", term: "event log", short: "Entries a contract writes into a transaction's receipt. They cannot be changed later and contracts cannot read them.", long: "The ledger emits RecordAppended for every record. Because the log is written once and lives outside contract storage, it is an independent witness of what the contract wrote." },
  { id: "calldata", term: "calldata", short: "The bytes a transaction sends to a contract: which function, and its arguments.", long: "The first four bytes select the function; the rest are its arguments, each padded to 32 bytes." },
  { id: "abi", term: "ABI encoding", short: "The agreed way to turn values into bytes, 32 bytes per value.", long: "The contract hashes the ABI encoding of a record's fields. The browser repeats the same encoding to check the hash for itself." },
  { id: "pullpayment", term: "pull payment", short: "Money is credited to you and you collect it yourself, instead of being sent to you automatically.", long: "With push payments one account that refuses ETH can block a whole sale. With pull payments it can only block itself." },
  { id: "snapshot", term: "snapshot", short: "A saved copy of the whole local chain that you can return to.", long: "The lab takes one when you open it, so every experiment can be undone." },
  { id: "anchor", term: "anchor", short: "Something the attacker cannot rewrite, used to check data against. Here, the event log.", long: "A hash chain proves its records agree with each other, not that they are the original ones. An anchor outside the attacker's reach, such as a log or a blockchain, closes that gap." },
];

const byId = new Map(GLOSSARY.map((g) => [g.id, g]));

export const termById = (id: string): GlossaryEntry | undefined => byId.get(id);

export interface RichPart {
  kind: "text" | "term";
  text: string;
  /** The glossary entry, for a term. */
  entry?: GlossaryEntry;
}

/**
 * Splits text with `[[id]]` or `[[id|shown text]]` markers into plain and glossary parts. An unknown
 * id is shown as plain text, so a typo can never break a sentence.
 */
export function parseRich(text: string): RichPart[] {
  const parts: RichPart[] = [];
  const re = /\[\[([a-z0-9]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    const entry = byId.get(m[1]!);
    parts.push(entry ? { kind: "term", text: m[2] ?? entry.term, entry } : { kind: "text", text: m[2] ?? m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
