import { describe, expect, it } from "vitest";
import { formatEth, group, groupedWord, shortAddress, shortHash } from "./format";

describe("shortHash / shortAddress", () => {
  const h = "0x" + "ab".repeat(32);
  it("keeps the first 6 and last 4 hex characters", () => {
    expect(shortHash(h)).toBe("0xababab…abab");
    expect(shortHash("0x" + "1234567890".repeat(6) + "1234")).toBe("0x123456…1234");
  });
  it("leaves short values alone", () => {
    expect(shortHash("0x1234")).toBe("0x1234");
    expect(shortHash("")).toBe("");
  });
  it("shortens addresses to 0x7099…79C8", () => {
    expect(shortAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
  });
});

describe("formatEth", () => {
  const eth = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;
  it("drops trailing zeros", () => {
    expect(formatEth(10n ** 18n)).toBe("1");
    expect(formatEth(eth("1.5"))).toBe("1.5");
    expect(formatEth(eth("0.25"))).toBe("0.25");
    expect(formatEth(0n)).toBe("0");
  });
  it("groups large amounts", () => {
    expect(formatEth(1234567n * 10n ** 18n)).toBe("1,234,567");
  });
  it("limits precision, and never shows a tiny amount as zero", () => {
    expect(formatEth(1_234_567_890_123_456_789n)).toBe("1.234567");
    expect(formatEth(1n)).toBe("< 0.000001");
    expect(formatEth(10n ** 12n)).toBe("0.000001");
    expect(formatEth(10n ** 11n)).toBe("< 0.000001");
  });
  it("accepts decimal strings and negatives", () => {
    expect(formatEth("2000000000000000000")).toBe("2");
    expect(formatEth(-(10n ** 18n) * 3n / 2n)).toBe("-1.5");
  });
  it("honours a different precision", () => {
    expect(formatEth(1_234_567_890_123_456_789n, 2)).toBe("1.23");
    expect(formatEth(1n, 2)).toBe("< 0.01"); // the smallest amount that precision can show
  });
});

describe("group / groupedWord", () => {
  it("adds thousands separators", () => {
    expect(group(0n)).toBe("0");
    expect(group(999n)).toBe("999");
    expect(group(1000n)).toBe("1,000");
    expect(group("1234567890")).toBe("1,234,567,890");
  });
  it("splits a 32-byte word into 8 groups of 8 hex digits", () => {
    const w = "0x" + "00".repeat(28) + "deadbeef";
    expect(groupedWord(w)).toEqual([...Array(7).fill("00000000"), "deadbeef"]);
    expect(groupedWord("0x1")).toHaveLength(8);
  });
});
