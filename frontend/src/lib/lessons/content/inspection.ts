import { ensureRecords } from "../setup";
import type { Lesson } from "../types";
import { T } from "./selectors";

export const whereRecordsLive: Lesson = {
  id: "where-records-live", title: "Where records live", minutes: 6,
  summary: "Look inside the contract's storage: eight slots per record, what writing them cost, and three ways to read them back.",
  setup: (env) => ensureRecords(env, 3),
  steps: [
    { id: "open", title: "Open the Storage page", target: T.nav, instruction: "Go to the **Storage** page.", done: (n) => n.route === "/storage" },
    { id: "pick", title: "Pick a record", instruction: "Choose a record from the list (or open a record on the Explorer and follow “See its storage slots”).", done: (n) => n.search.includes("record=") },
    { id: "slots", title: "Read the eight slots", target: T.slots, readOnly: true, instruction: "A record takes **eight storage slots**. Each shows the fields it holds, its raw 32-byte value, and a ✔ when the node holds exactly what the layout predicts.", done: () => false },
    { id: "packed", title: "Spot the packed slot", target: T.slots, readOnly: true, instruction: "One slot holds two fields, the **action** (1 byte) and the **actor** (20 bytes). Small values share a [[slot]] to save space, which is why nine fields fit in eight slots.", done: () => false },
    { id: "cost", title: "See what it cost", target: T.cost, readOnly: true, instruction: "Each [[slot]] written has a [[gas]] price. A slot going from zero to non-zero costs the most. The packed slot is written twice, the second time cheaply. An [[eventlog]] entry would cost a fraction, but a contract cannot read events.", done: () => false },
    { id: "readback", title: "Read it back three ways", target: T.readback, readOnly: true, instruction: "The same record can be read by asking the contract, by reading raw storage, and from the event log. The first two read the same storage; the log is the independent witness.", done: () => false },
  ],
  quiz: [
    { id: "slots", question: "How many storage slots does one record use?", choices: ["1", "8", "32"], answer: 1, explanation: "Nine fields, but the action and actor share a slot, so eight." },
    { id: "cheap", question: "Why is an event cheaper than storage?", choices: ["It is not stored on any node", "It is written to a transaction's log instead of the contract's permanent state", "It is compressed"], answer: 1, explanation: "Logs are cheap because contracts cannot read them. That is also why they make a good independent witness." },
  ],
};

export const breakingTheChain: Lesson = {
  id: "breaking-the-chain", title: "Breaking the chain", minutes: 10, needsLab: true,
  summary: "Attack the ledger on purpose and see which defences notice, and which are fooled.",
  setup: (env) => ensureRecords(env, 5),
  steps: [
    { id: "open", title: "Open the Tamper Lab", target: T.nav, instruction: "Go to the **Tamper Lab**. It takes a safety snapshot first, so everything can be undone.", done: (n) => n.route === "/tamper" },
    { id: "level1", title: "Level 1: edit the data", target: T.levels, instruction: "Choose **Level 1** and press **Run the attack**. Predict first: which records will be flagged?", done: (n, s) => n.tampers > s.tampers && n.brokenRecords > 0 },
    { id: "verdicts", title: "Read the verdicts", target: T.levels, readOnly: true, instruction: "Only the edited record is flagged. Its stored [[hash]] no longer fits its data. The links around it still look fine, because the next record still points at the hash that is stored.", done: () => false },
    { id: "undo", title: "Undo it", target: T.nav, instruction: "Press **Undo last attack**. The record verifies again.", done: (n, s) => n.restores > s.restores && n.brokenRecords === 0 },
    { id: "level3", title: "Level 3: rewrite the tail", target: T.levels, instruction: "Choose **Level 3** and run it. Every hash and link from the edited record onward is recomputed.", hint: "Look at the three verdicts afterwards.", done: (n, s) => n.fooled > s.fooled },
    { id: "fooled", title: "Why was the contract fooled?", target: T.levels, readOnly: true, instruction: "The contract's own check says the ledger is valid: the rewritten tail is consistent with itself. Your browser still catches it, because it compares with the [[eventlog]], which the attacker could not rewrite. That log is the [[anchor]].", done: () => false },
    { id: "restore", title: "Restore everything", instruction: "Press **Restore everything** to return the whole chain to how it was when you opened the lab.", done: (n, s) => n.brokenRecords === 0 && n.restores > s.restores },
  ],
  quiz: [
    { id: "auth", question: "A hash chain proves the records are...", choices: ["Authentic: exactly what was originally written", "Consistent with each other, but not necessarily original", "Encrypted"], answer: 1, explanation: "A complete rewrite is consistent with itself. To prove authenticity you need an [[anchor]] the attacker cannot rewrite." },
    { id: "first", question: "Why does verifyLedger() name only one record when two were edited?", choices: ["Only one was really changed", "It stops at the first problem; auditRange lists them all", "It cannot read the second"], answer: 1, explanation: "verifyLedger answers “is it intact?” cheaply and reports the first break. auditRange and a full audit find every change." },
    { id: "real", question: "Could an attacker do this on a real blockchain?", choices: ["Yes, easily", "No: nobody can rewrite stored data, which is why a blockchain is trustworthy", "Only with the contract's owner key"], answer: 1, explanation: "This works only because the lab controls a local chain. On a real network, rewriting history would mean redoing the blocks everyone else holds." },
  ],
};
