import { describe, expect, it } from "vitest";
import { AbiCoder, Interface, parseEther } from "ethers";
import { customErrorNames, marketInterface } from "../src/abi";
import { explainError, explainRevert, findRevertData } from "../src/errorExplainer";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const encode = (name: string, args: unknown[] = []) => marketInterface.encodeErrorResult(name, args);

const SAMPLES: Record<string, unknown[]> = {
  EmptyName: [], InvalidPrice: [], ProductNotFound: [99n], NotProductOwner: [1n, A], NotListed: [1n],
  CannotBuyOwnProduct: [1n], IncorrectPayment: [parseEther("1"), parseEther("0.5")], PaymentFailed: [A],
  ProductReserved: [1n], NotReserved: [1n], NotReservationBuyer: [1n, A], ReservationExpired: [1n, 1700000000n],
  ReservationNotExpired: [1n, 1700000000n], NothingToWithdraw: [A], WithdrawFailed: [A],
  RecordNotFound: [5n], InvalidRange: [3n, 2n],
};

describe("explainRevert", () => {
  it("has a sample and a dedicated explanation for every custom error in the ABI", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...customErrorNames].sort());
    for (const name of customErrorNames) {
      const e = explainRevert(encode(name, SAMPLES[name]));
      expect(e.kind).toBe("custom");
      expect(e.name).toBe(name);
      expect(e.reverts).toBe(true);
      expect(e.title).not.toBe(name);        // a hand-written title, not the fallback
      expect(e.explanation.length).toBeGreaterThan(20);
      expect(e.fix.length).toBeGreaterThan(5);
    }
  });

  it("formats arguments into the explanation", () => {
    const pay = explainRevert(encode("IncorrectPayment", [parseEther("1"), parseEther("0.5")]));
    expect(pay.explanation).toContain("expected 1.0 ETH, sent 0.5 ETH");
    expect(pay.args).toEqual({ expected: "1000000000000000000", sent: "500000000000000000" });

    const owner = explainRevert(encode("NotProductOwner", [3n, A]));
    expect(owner.explanation).toContain("#3");
    expect(owner.explanation).toContain("0x7099…79C8");
  });

  it("uses role names when a labeller is given", () => {
    const e = explainRevert(encode("NotProductOwner", [1n, A]), { labelAddress: () => "Outsider" });
    expect(e.explanation).toContain("Outsider");
  });

  it("explains that a failed payment rolled the whole sale back", () => {
    expect(explainRevert(encode("PaymentFailed", [A])).explanation).toContain("rolled back");
  });

  it("decodes Error(string) and Panic(uint256)", () => {
    const coder = AbiCoder.defaultAbiCoder();
    const err = "0x08c379a0" + coder.encode(["string"], ["nope"]).slice(2);
    expect(explainRevert(err)).toMatchObject({ kind: "revertString", args: { reason: "nope" } });
    const panic = "0x4e487b71" + coder.encode(["uint256"], [0x11]).slice(2);
    const p = explainRevert(panic);
    expect(p.kind).toBe("panic");
    expect(p.explanation).toContain("overflow");
  });

  it("handles empty and unknown revert data", () => {
    expect(explainRevert("0x").title).toBe("Reverted without a reason");
    const unknown = explainRevert("0xdeadbeef");
    expect(unknown.title).toBe("Unknown error");
    expect(unknown.reverts).toBe(true);
  });
});

describe("explainError", () => {
  it("finds revert data nested in an ethers/JSON-RPC style error", () => {
    const data = encode("NotListed", [7n]);
    const nested = { code: "CALL_EXCEPTION", info: { error: { code: -32603, data: { message: "x", data } } } };
    expect(findRevertData(nested)).toBe(data);
    expect(explainError(nested).name).toBe("NotListed");
    expect(explainError({ data }).name).toBe("NotListed");
  });

  it("recognises wallet and node failures", () => {
    expect(explainError({ code: "ACTION_REJECTED" })).toMatchObject({ kind: "wallet", title: "Signature rejected", reverts: false });
    expect(explainError({ code: "INSUFFICIENT_FUNDS" }).title).toBe("Not enough ETH");
    expect(explainError({ code: "NONCE_EXPIRED" }).fix).toContain("Clear activity");
    expect(explainError({ code: "REPLACEMENT_UNDERPRICED" }).title).toBe("Replacement fee too low");
    expect(explainError({ code: "NETWORK_ERROR" }).kind).toBe("network");
    expect(explainError(new Error("MetaMask Tx Signature: User denied transaction signature.")).name).toBe("ACTION_REJECTED");
  });

  it("falls back to the message for anything else", () => {
    const e = explainError(new Error("boom"));
    expect(e.kind).toBe("unknown");
    expect(e.explanation).toBe("boom");
  });

  it("does not loop forever on circular errors", () => {
    const a: Record<string, unknown> = {};
    a.error = a;
    expect(findRevertData(a)).toBeNull();
  });
});

describe("interface sanity", () => {
  it("parseError understands the builtin errors without them being in the ABI", () => {
    expect(new Interface([]).parseError("0x4e487b71" + "00".repeat(31) + "01")?.name).toBe("Panic");
  });
});
