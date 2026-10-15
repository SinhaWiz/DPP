import { describe, expect, it } from "vitest";
import { GLOSSARY, parseRich, termById } from "./glossary";

describe("glossary", () => {
  it("has the terms the roadmap promised, each explained in one sentence and in more detail", () => {
    for (const id of ["hash", "keccak256", "nonce", "gas", "revert", "mempool", "genesis", "wei", "escrow", "slot", "eventlog"]) {
      const e = termById(id);
      expect(e, id).toBeDefined();
      expect(e!.short.length, id).toBeGreaterThan(20);
      expect(e!.long.length, id).toBeGreaterThanOrEqual(e!.short.length); // the fuller explanation says more, not less
    }
  });

  it("keeps tooltips short enough to read at a glance", () => {
    for (const g of GLOSSARY) expect(g.short.length, g.id).toBeLessThan(200);
  });

  it("has unique ids and unique terms", () => {
    expect(new Set(GLOSSARY.map((g) => g.id)).size).toBe(GLOSSARY.length);
    expect(new Set(GLOSSARY.map((g) => g.term.toLowerCase())).size).toBe(GLOSSARY.length);
  });

  it("returns undefined for an unknown term", () => {
    expect(termById("nope")).toBeUndefined();
  });
});

describe("parseRich", () => {
  it("splits plain text and terms", () => {
    const parts = parseRich("Each [[nonce]] is used once, so [[gas|the fee]] is spent.");
    expect(parts.map((p) => [p.kind, p.text])).toEqual([
      ["text", "Each "], ["term", "nonce"], ["text", " is used once, so "], ["term", "the fee"], ["text", " is spent."],
    ]);
    expect(parts[1]!.entry!.id).toBe("nonce");
    expect(parts[3]!.entry!.id).toBe("gas");
  });

  it("leaves text without markers alone", () => {
    expect(parseRich("nothing special")).toEqual([{ kind: "text", text: "nothing special" }]);
    expect(parseRich("")).toEqual([]);
  });

  it("never breaks a sentence over an unknown term", () => {
    expect(parseRich("a [[typo]] b").map((p) => p.text).join("")).toBe("a typo b");
    expect(parseRich("a [[typo|shown]] b").map((p) => p.text).join("")).toBe("a shown b");
  });

  it("handles adjacent and leading markers", () => {
    const parts = parseRich("[[hash]][[nonce]]!");
    expect(parts.map((p) => p.kind)).toEqual(["term", "term", "text"]);
  });
});
