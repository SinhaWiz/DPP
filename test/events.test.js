const { expect } = require("chai");
const { ethers } = require("hardhat");
const { tamperWithPrice, tamperWithHash, recomputeHash } = require("./helpers/tamper");

const Action = { Registered: 0n, Listed: 1n, Delisted: 2n, Sold: 3n };

/** Rebuilds the (index, prevHash, hash) sequence from RecordAppended logs alone. */
async function chainFromLogs(c) {
  const logs = await c.queryFilter(c.filters.RecordAppended());
  return logs.map((l) => ({ index: l.args.index, prevHash: l.args.prevHash, hash: l.args.hash }));
}

describe("RecordAppended event", () => {
  let c, seller, buyer;
  const price = ethers.parseEther("1");

  beforeEach(async () => {
    [seller, buyer] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  });

  it("carries index, product, action, actor, prevHash and hash for a registration", async () => {
    const tx = await c.registerProduct("Laptop");
    const rec = await c.getRecord(0);
    await expect(tx)
      .to.emit(c, "RecordAppended")
      .withArgs(0, 1, Action.Registered, seller.address, ethers.ZeroHash, rec.hash);
  });

  it("emits the matching arguments for list, delist and sale", async () => {
    await c.registerProduct("Laptop");

    const list = await c.listForSale(1, price);
    const listed = await c.getRecord(1);
    await expect(list).to.emit(c, "RecordAppended")
      .withArgs(1, 1, Action.Listed, seller.address, (await c.getRecord(0)).hash, listed.hash);

    const delist = await c.cancelListing(1);
    const delisted = await c.getRecord(2);
    await expect(delist).to.emit(c, "RecordAppended")
      .withArgs(2, 1, Action.Delisted, seller.address, listed.hash, delisted.hash);

    await c.listForSale(1, price);
    const sale = await c.connect(buyer).buy(1, { value: price });
    const sold = await c.getRecord(4);
    // For a sale the actor is the seller (the buyer is the counterparty).
    await expect(sale).to.emit(c, "RecordAppended")
      .withArgs(4, 1, Action.Sold, seller.address, (await c.getRecord(3)).hash, sold.hash);
  });

  it("can be filtered by actor", async () => {
    await c.registerProduct("Laptop");
    await c.connect(buyer).registerProduct("Phone");
    const mine = await c.queryFilter(c.filters.RecordAppended(null, null, null, seller.address));
    expect(mine.map((l) => l.args.index)).to.deep.equal([0n]);
  });

  it("rebuilds the full chain from logs, matching storage", async () => {
    await c.registerProduct("Laptop");
    await c.listForSale(1, price);
    await c.connect(buyer).buy(1, { value: price });
    await c.connect(buyer).listForSale(1, price * 2n);

    const fromLogs = await chainFromLogs(c);
    const fromStorage = await c.getRecords(0, 100);
    expect(fromLogs).to.have.lengthOf(fromStorage.length);
    fromLogs.forEach((entry, i) => {
      expect(entry.index).to.equal(fromStorage[i].index);
      expect(entry.prevHash).to.equal(fromStorage[i].prevHash);
      expect(entry.hash).to.equal(fromStorage[i].hash);
      // the log chain links on its own
      expect(entry.prevHash).to.equal(i === 0 ? ethers.ZeroHash : fromLogs[i - 1].hash);
    });
  });

  describe("as an independent witness (storage vs logs)", () => {
    beforeEach(async () => {
      await c.registerProduct("Laptop");
      await c.listForSale(1, price);
      await c.connect(buyer).buy(1, { value: price });
    });

    it("keeps the original chain in the logs after storage is tampered with", async () => {
      const before = await chainFromLogs(c);
      await tamperWithPrice(c, 1);
      await tamperWithHash(c, 1, await recomputeHash(c, 1));

      expect(await chainFromLogs(c)).to.deep.equal(before);
      // storage now disagrees with the log at the forged record
      const stored = await c.getRecord(1);
      expect(stored.hash).to.not.equal(before[1].hash);
    });
  });
});
