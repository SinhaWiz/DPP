import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, keccak256, parseEther } from "ethers";
import { startDevNode, deployContracts, type DevNode, type Deployed } from "../src/testing/devNode";
import {
  buildFieldWrite, decodeActionActor, ledgerBaseSlot, ledgerLengthSlot, mappingSlot, readPacked,
  recordSlot, recordSlotViews, word, writePacked, variableSlot,
} from "../src/storageLayout";
import { toLedgerRecord, type LedgerRecord } from "../src/types";

describe("slot maths (pure)", () => {
  it("puts the ledger length at slot 0 and the data at keccak256(0)", () => {
    expect(ledgerLengthSlot()).toBe(0n);
    // keccak256 of 32 zero bytes: the well-known start of the first dynamic array's data
    expect(word(ledgerBaseSlot())).toBe("0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563");
  });

  it("lays records out 8 slots apart with the documented member positions", () => {
    const base = ledgerBaseSlot();
    expect(recordSlot(0, "index")).toBe(base);
    expect(recordSlot(0, "timestamp")).toBe(base + 1n);
    expect(recordSlot(0, "action")).toBe(base + 3n);
    expect(recordSlot(0, "actor")).toBe(base + 3n);
    expect(recordSlot(0, "price")).toBe(base + 5n);
    expect(recordSlot(0, "hash")).toBe(base + 7n);
    expect(recordSlot(2, "price")).toBe(base + 16n + 5n);
  });

  it("reads other variables from the compiler layout", () => {
    expect(variableSlot("productCount")).toBe(2n);
    expect(variableSlot("pendingWithdrawals")).toBe(5n);
    expect(() => variableSlot("nope")).toThrow();
  });

  it("packs and unpacks without disturbing neighbours", () => {
    const actor = 0x70997970c51812dc3a010c7d01b50e0d17dc79c8n;
    const packed = writePacked(writePacked(0n, 0, 1, 3n), 1, 20, actor);
    expect(readPacked(packed, 0, 1)).toBe(3n);
    expect(readPacked(packed, 1, 20)).toBe(actor);
    expect(readPacked(writePacked(packed, 0, 1, 5n), 1, 20)).toBe(actor); // changing action keeps actor
    expect(readPacked(writePacked(packed, 1, 20, 0n), 0, 1)).toBe(3n);    // changing actor keeps action
    expect(decodeActionActor(packed)).toEqual({ action: 3, actor: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
  });

  it("computes mapping slots as keccak256(abi.encode(key, slot))", () => {
    expect(mappingSlot(1n, 3, "uint256")).toBe(BigInt(keccak256(word(1n) + word(3n).slice(2))));
  });

  it("describes a record's eight slots with the packed one holding two members", () => {
    const r = toLedgerRecord({
      index: 0, timestamp: 1700000000, productId: 1, action: 3,
      actor: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      counterparty: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", price: 10n ** 18n,
      prevHash: "0x" + "00".repeat(32), hash: "0x" + "ab".repeat(32),
    });
    const views = recordSlotViews(r);
    expect(views).toHaveLength(8);
    expect(views[3]!.members.map((m) => m.name)).toEqual(["action", "actor"]);
    expect(views[3]!.value).toBe(word(writePacked(writePacked(0n, 0, 1, 3n), 1, 20, BigInt(r.actor))));
    expect(views[7]!.value).toBe(r.hash);
    expect(views[0]!.slot).toBe(ledgerBaseSlot());
  });
});

// ─────────────── against a real chain ───────────────
describe("slot maths against real contract storage", () => {
  let node: DevNode;
  let d: Deployed;
  let market: Contract;
  let records: LedgerRecord[];

  beforeAll(async () => {
    node = await startDevNode();
    d = await deployContracts(node.provider);
    market = d.market;
    const [seller, buyer] = d.signers;
    const send = async (signer: typeof seller, fn: string, ...args: unknown[]) =>
      (await (market.connect(signer!) as Contract).getFunction(fn)(...args)).wait();
    await send(seller, "registerProduct", "Laptop");
    await send(seller, "listForSale", 1, parseEther("1"));
    await send(buyer, "buy", 1, { value: parseEther("1") });
    records = ((await market.getFunction("getRecords")(0, 100)) as never[]).map(toLedgerRecord);
  }, 90_000);

  afterAll(async () => { await node?.stop(); });

  const slotValue = async (slot: bigint) => BigInt(await node.provider.getStorage(await market.getAddress(), slot));

  it("finds the ledger length where the layout says", async () => {
    expect(await slotValue(ledgerLengthSlot())).toBe(BigInt(records.length));
  });

  it("predicts the exact raw value of every slot of every record", async () => {
    expect(records).toHaveLength(3);
    for (const r of records) {
      for (const v of recordSlotViews(r)) {
        expect(word(await slotValue(v.slot)), `record #${r.index} slot ${v.position}`).toBe(v.value);
      }
    }
  });

  it("writes a single field (including the packed one) without side effects", async () => {
    const address = await market.getAddress();
    const write = async (slot: bigint, value: bigint) =>
      node.provider.send("hardhat_setStorageAt", [address, word(slot), word(value)]);

    // change the price of record 1
    const p = buildFieldWrite(1, "price", 4242n, await slotValue(recordSlot(1, "price")));
    await write(p.slot, p.value);
    expect((await market.getFunction("getRecord")(1)).price).toBe(4242n);

    // change the action of record 2 (Sold → Delisted); the actor sharing the slot must survive
    const before = await market.getFunction("getRecord")(2);
    const a = buildFieldWrite(2, "action", 2n, await slotValue(recordSlot(2, "action")));
    await write(a.slot, a.value);
    const after = await market.getFunction("getRecord")(2);
    expect(Number(after.action)).toBe(2);
    expect(after.actor).toBe(before.actor);

    // change the actor; the action must survive
    const b = buildFieldWrite(2, "actor", BigInt(await d.signers[4]!.getAddress()), await slotValue(recordSlot(2, "actor")));
    await write(b.slot, b.value);
    const final = await market.getFunction("getRecord")(2);
    expect(final.actor).toBe(await d.signers[4]!.getAddress());
    expect(Number(final.action)).toBe(2);

    // and the contract notices: data tampering is detected at those records
    const [valid, brokenAt] = await market.getFunction("verifyLedger")();
    expect(valid).toBe(false);
    expect(brokenAt).toBe(1n);
  });
});
