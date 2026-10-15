import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { customErrorNames, type ApiTx, type WsMessage } from "@dpp/shared";
import { parseRich } from "./glossary";
import { narrate, type NarrationContext } from "./narration";
import { SNIPPETS } from "./snippets";

const msg = (type: WsMessage["type"], data: unknown = {}, seq = 1): WsMessage => ({ seq, type, at: 5, data });
const noTx: NarrationContext = { findTx: () => undefined };
const failedTx = (name = "NotListed"): ApiTx =>
  ({ hash: "0xabc", revert: { name, title: "Not for sale", explanation: "Product #1 is not listed.", fix: "List it first.", args: {}, data: "0x", approximate: false } }) as unknown as ApiTx;

describe("snippets", () => {
  // the contract's source, with whitespace collapsed so indentation does not matter
  const source = readFileSync(resolve(process.cwd(), "../contracts/BuySellTraceability.sol"), "utf8").replace(/\s+/g, " ");
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();

  it("quote the real contract: every line appears in the source", () => {
    for (const [error, snippet] of Object.entries(SNIPPETS)) {
      for (const line of snippet.lines) expect(source, `${error}: ${line}`).toContain(squash(line));
    }
  });

  it("each snippet names the error it explains", () => {
    for (const [error, snippet] of Object.entries(SNIPPETS)) expect(snippet.lines.join(" "), error).toContain(error);
  });

  it("cover every error a transaction can raise", () => {
    const reachable = customErrorNames.filter((e) => !["RecordNotFound", "InvalidRange"].includes(e));
    expect(Object.keys(SNIPPETS).sort()).toEqual([...reachable].sort());
  });
});

describe("narrate", () => {
  it("explains a mined block, an empty one, and says the two chains are different", () => {
    const full = narrate(msg("block.new", { number: 7, txCount: 2 }), noTx)!;
    expect(full.title).toBe("Ethereum block 7 mined");
    expect(full.body).toContain("2 transactions");
    expect(full.body).toContain("separate from the ledger");
    expect(narrate(msg("block.new", { number: 8, txCount: 0 }), noTx)!.body).toContain("empty");
    expect(narrate(msg("block.new", { number: 9, txCount: 1 }), noTx)!.body).toContain("containing 1 transaction.");
  });

  it("explains a pending transaction: only a request until mined", () => {
    const n = narrate(msg("tx.pending", { functionName: "buy", args: { productId: "1" } }), noTx)!;
    expect(n.title).toBe("Waiting in the mempool");
    expect(n.body).toContain("buy(1)");
    expect(n.body).toContain("only a request");
  });

  it("explains a refusal using the transaction's own reason, and attaches the contract code behind it", () => {
    const n = narrate(msg("tx.failed", { hash: "0xabc" }), { findTx: () => failedTx() })!;
    expect(n).toMatchObject({ level: "bad", title: "Refused: Not for sale", lesson: "rules-and-reverts" });
    expect(n.body).toContain("Product #1 is not listed.");
    expect(n.body).toContain("nothing was recorded");
    expect(n.detail).toBe("How to fix it: List it first.");
    expect(n.code!.lines[0]).toContain("NotListed");
  });

  it("still explains a revert whose reason is not known yet", () => {
    const n = narrate(msg("tx.failed", { hash: "0xunknown" }), noTx)!;
    expect(n.title).toBe("Transaction reverted");
    expect(n.code).toBeUndefined();
    expect(n.body).toContain("[[revert]]");
  });

  it("explains replaced and dropped transactions as never having run", () => {
    expect(narrate(msg("tx.replaced"), noTx)!.body).toContain("never mined");
    expect(narrate(msg("tx.replaced"), noTx)!.detail).toContain("0-ETH transfer to yourself");
    expect(narrate(msg("tx.dropped"), noTx)!.body).toContain("never ran");
  });

  it("explains a new record and how it links to the one before", () => {
    const n = narrate(msg("record.appended", { index: "5" }), noTx)!;
    expect(n.title).toBe("Ledger record #5 added");
    expect(n.body).toContain("record #4");
    expect(n.detail).toContain("independent witness");
    expect(narrate(msg("record.appended", { index: "0" }), noTx)!.body).toContain("record #0"); // no "record #-1"
  });

  it("announces when verification fails or recovers", () => {
    const bad = narrate(msg("verification.changed", { valid: false, firstBrokenAt: "3" }), noTx)!;
    expect(bad).toMatchObject({ level: "bad", title: "Record #3 no longer verifies", lesson: "breaking-the-chain" });
    const good = narrate(msg("verification.changed", { valid: true }), noTx)!;
    expect(good).toMatchObject({ level: "good", title: "Every record verifies" });
    expect(good.lesson).toBeUndefined();
  });

  it("explains resets, rewinds and the MetaMask tip", () => {
    expect(narrate(msg("chain.reset"), noTx)!.detail).toContain("Clear activity tab data");
    expect(narrate(msg("chain.rewound", { fromBlock: 9, toBlock: 3 }), noTx)!.body).toContain("from block 9 to block 3");
  });

  it("tells a tamper that fooled the contract apart from one it caught", () => {
    const fooled = narrate(msg("lab.tampered", { mode: "rewrite-tail", onChain: { valid: true }, offChain: { valid: false } }), noTx)!;
    expect(fooled.body).toContain("contract's own check says everything is fine");
    const caught = narrate(msg("lab.tampered", { mode: "data", onChain: { valid: false }, offChain: { valid: false } }), noTx)!;
    expect(caught.body).toContain("Watch which of the defences notice");
    expect(caught.detail).toContain("local chain");
  });

  it("describes each mining mode", () => {
    expect(narrate(msg("mining.changed", { mode: "manual" }), noTx)!.title).toBe("Step mode");
    expect(narrate(msg("mining.changed", { mode: "interval" }), noTx)!.title).toBe("Slow motion");
    expect(narrate(msg("mining.changed", { mode: "auto" }), noTx)!.title).toBe("Automatic mining");
  });

  it("stays quiet about chatter", () => {
    for (const t of ["indexer.status", "lab.scenario"] as const) expect(narrate(msg(t), noTx)).toBeNull();
  });

  it("gives every narration a stable id so the same message is never shown twice", () => {
    expect(narrate(msg("block.new", {}, 12), noTx)!.id).toBe("12-block.new");
  });

  it("only uses glossary terms that exist", () => {
    const samples: WsMessage[] = [
      msg("block.new", { number: 1, txCount: 0 }), msg("block.new", { number: 1, txCount: 3 }), msg("tx.pending", {}), msg("tx.mined", {}),
      msg("tx.failed", { hash: "0xabc" }), msg("tx.replaced"), msg("record.appended", { index: "2" }), msg("verification.changed", { valid: false, firstBrokenAt: "1" }),
      msg("verification.changed", { valid: true }), msg("chain.reset"), msg("chain.rewound", {}), msg("lab.tampered", { mode: "data" }), msg("mining.changed", { mode: "manual" }),
    ];
    for (const s of samples) {
      const n = narrate(s, { findTx: () => failedTx() })!;
      for (const text of [n.body, n.detail ?? ""]) {
        for (const part of parseRich(text)) {
          if (part.kind === "text") expect(part.text, `${s.type}: unknown marker in "${text}"`).not.toMatch(/\[\[/);
        }
        expect(text.match(/\[\[([a-z0-9]+)/g)?.length ?? 0, s.type).toBe(parseRich(text).filter((p) => p.kind === "term").length);
      }
    }
  });
});
