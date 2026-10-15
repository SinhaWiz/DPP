import { describe, expect, it } from "vitest";
import { ACTIONS, Action, GENESIS_HASH, toLedgerRecord } from "../src/types";
import { ACTION_META, actionLabel } from "../src/actions";
import { customErrorNames, marketInterface, storageLayout } from "../src/abi";
import { LIFECYCLE_META, VERIFICATION_META } from "../src/status";

describe("actions", () => {
  it("has metadata for every action, with unique labels and colours", () => {
    expect(ACTIONS).toHaveLength(6);
    const labels = ACTIONS.map((a) => ACTION_META[a].label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(ACTIONS.map((a) => ACTION_META[a].color)).size).toBe(6);
    expect(actionLabel(Action.Revoked)).toBe("Revoked");
  });

  it("matches the contract's enum order", () => {
    const fragment = marketInterface.getEvent("RecordAppended")!;
    expect(fragment.inputs.map((i) => i.name)).toEqual(["index", "productId", "action", "actor", "prevHash", "hash"]);
    expect(Action.Sold).toBe(3);
    expect(Action.Reserved).toBe(4);
    expect(Action.Revoked).toBe(5);
  });

  it("covers every verification and lifecycle state", () => {
    expect(Object.keys(VERIFICATION_META)).toEqual(["intact", "dataTampered", "linkBroken", "anchorMismatch"]);
    expect(Object.keys(LIFECYCLE_META)).toContain("replaced");
  });
});

describe("toLedgerRecord", () => {
  it("accepts JSON-style string numbers", () => {
    const r = toLedgerRecord({
      index: "2", timestamp: "1700000000", productId: "1", action: 3,
      actor: "0xabc", counterparty: "0xdef", price: "1000000000000000000",
      prevHash: GENESIS_HASH, hash: GENESIS_HASH,
    });
    expect(r.index).toBe(2n);
    expect(r.price).toBe(10n ** 18n);
    expect(r.action).toBe(Action.Sold);
  });
});

describe("abi", () => {
  it("exposes the custom errors and the storage layout", () => {
    expect(customErrorNames).toContain("IncorrectPayment");
    expect(customErrorNames).toContain("WithdrawFailed");
    expect(storageLayout.variables._ledger!.slot).toBe(0);
    expect(storageLayout.record.slots).toBe(8);
  });
});
