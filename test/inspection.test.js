const { expect } = require("chai");
const { ethers } = require("hardhat");
const { tamperWithPrice, tamperWithHash, recomputeHash, tamperField } = require("./helpers/tamper");

const REASON_DATA = 1n;
const REASON_LINK = 2n;

describe("inspection", () => {
  let c, buyer;
  const price = ethers.parseEther("1");

  beforeEach(async () => {
    [, buyer] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
    await c.registerProduct("Laptop");      // #0
    await c.listForSale(1, price);          // #1
    await c.connect(buyer).buy(1, { value: price }); // #2
    await c.connect(buyer).listForSale(1, price * 2n); // #3
    await c.connect(buyer).cancelListing(1); // #4
  });

  describe("inspectRecord", () => {
    it("reports an intact record with matching hashes", async () => {
      const r = await c.inspectRecord(2);
      expect(r.dataOk).to.equal(true);
      expect(r.linkOk).to.equal(true);
      expect(r.recomputedHash).to.equal(r.record.hash);
      expect(r.expectedPrevHash).to.equal((await c.getRecord(1)).hash);
      expect(r.record.index).to.equal(2n);
    });

    it("expects the genesis hash for record #0", async () => {
      const r = await c.inspectRecord(0);
      expect(r.expectedPrevHash).to.equal(ethers.ZeroHash);
      expect(r.linkOk).to.equal(true);
    });

    it("flags a data change on the record itself and leaves the next link intact", async () => {
      await tamperWithPrice(c, 2);
      const bad = await c.inspectRecord(2);
      expect(bad.dataOk).to.equal(false);
      expect(bad.linkOk).to.equal(true);
      expect(bad.recomputedHash).to.not.equal(bad.record.hash);
      const next = await c.inspectRecord(3);
      expect(next.dataOk).to.equal(true);
      expect(next.linkOk).to.equal(true); // the stored hash of #2 was not touched
    });

    it("moves the problem to the next link when the attacker also fixes the hash", async () => {
      await tamperWithPrice(c, 2);
      await tamperWithHash(c, 2, await recomputeHash(c, 2));
      const forged = await c.inspectRecord(2);
      expect(forged.dataOk).to.equal(true);
      expect(forged.linkOk).to.equal(true);
      const next = await c.inspectRecord(3);
      expect(next.dataOk).to.equal(true);
      expect(next.linkOk).to.equal(false); // #3 still points at the original hash of #2
    });

    it("reverts for an unknown index", async () => {
      await expect(c.inspectRecord(5)).to.be.revertedWithCustomError(c, "RecordNotFound").withArgs(5);
    });
  });

  describe("auditRange", () => {
    it("returns empty arrays for an intact chain, an empty range and a mid-chain range", async () => {
      for (const [a, b] of [[0, 5], [3, 3], [2, 4]]) {
        const [idx, why] = await c.auditRange(a, b);
        expect(idx).to.have.lengthOf(0);
        expect(why).to.have.lengthOf(0);
      }
    });

    it("reports a data tamper with reason DATA only", async () => {
      await tamperWithPrice(c, 2);
      const [idx, why] = await c.auditRange(0, 5);
      expect(idx).to.deep.equal([2n]);
      expect(why).to.deep.equal([REASON_DATA]);
    });

    it("reports a forged hash as a LINK break on the following record", async () => {
      await tamperWithPrice(c, 2);
      await tamperWithHash(c, 2, await recomputeHash(c, 2));
      const [idx, why] = await c.auditRange(0, 5);
      expect(idx).to.deep.equal([3n]);
      expect(why).to.deep.equal([REASON_LINK]);
    });

    it("reports several separate problems, unlike verifyLedger which stops at the first", async () => {
      await tamperWithPrice(c, 1);
      await tamperWithPrice(c, 3);
      const [idx, why] = await c.auditRange(0, 5);
      expect(idx).to.deep.equal([1n, 3n]);
      expect(why).to.deep.equal([REASON_DATA, REASON_DATA]);
      expect(await c.verifyLedger()).to.deep.equal([false, 1n]);
    });

    it("sets both reason bits when data and link are both wrong", async () => {
      await tamperWithPrice(c, 2);
      await tamperField(c, 2, "prevHash", ethers.id("elsewhere"));
      const [idx, why] = await c.auditRange(0, 5);
      expect(idx).to.deep.equal([2n]);
      expect(why).to.deep.equal([REASON_DATA | REASON_LINK]);
    });

    it("only reports problems inside the requested range", async () => {
      await tamperWithPrice(c, 1);
      await tamperWithPrice(c, 4);
      const [idx] = await c.auditRange(2, 5);
      expect(idx).to.deep.equal([4n]);
    });

    it("rejects invalid ranges", async () => {
      await expect(c.auditRange(3, 2)).to.be.revertedWithCustomError(c, "InvalidRange").withArgs(3, 2);
      await expect(c.auditRange(0, 6)).to.be.revertedWithCustomError(c, "InvalidRange").withArgs(0, 6);
    });
  });

  describe("agreement with verifyLedger / verifyRange", () => {
    it("verifyLedger's brokenAt is the first index auditRange reports", async () => {
      await tamperWithPrice(c, 3);
      await tamperWithPrice(c, 4);
      const [valid, brokenAt] = await c.verifyLedger();
      const [idx] = await c.auditRange(0, 5);
      expect(valid).to.equal(false);
      expect(brokenAt).to.equal(idx[0]);
    });

    it("agree that an intact chain is valid", async () => {
      expect((await c.verifyLedger())[0]).to.equal(true);
      expect((await c.auditRange(0, 5))[0]).to.have.lengthOf(0);
    });
  });
});
