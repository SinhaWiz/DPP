const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("bulk reads", () => {
  let c, owner;
  const price = ethers.parseEther("1");

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  });

  describe("headHash", () => {
    it("is the all-zero genesis hash on an empty ledger", async () => {
      expect(await c.headHash()).to.equal(ethers.ZeroHash);
    });

    it("tracks the hash of the newest record", async () => {
      await c.registerProduct("Laptop");
      expect(await c.headHash()).to.equal((await c.getRecord(0)).hash);
      await c.listForSale(1, price);
      expect(await c.headHash()).to.equal((await c.getRecord(1)).hash);
    });

    it("is the prevHash of the next record", async () => {
      await c.registerProduct("Laptop");
      const head = await c.headHash();
      await c.listForSale(1, price);
      expect((await c.getRecord(1)).prevHash).to.equal(head);
    });
  });

  describe("getRecords", () => {
    beforeEach(async () => {
      await c.registerProduct("Laptop");
      for (let i = 1n; i <= 4n; i++) await c.listForSale(1, price * i); // 5 records
    });

    it("returns the requested window in order", async () => {
      const page = await c.getRecords(1, 3);
      expect(page.map((r) => r.index)).to.deep.equal([1n, 2n, 3n]);
    });

    it("matches getRecord for every index", async () => {
      const all = await c.getRecords(0, 100);
      expect(all).to.have.lengthOf(5);
      for (let i = 0; i < 5; i++) {
        expect(all[i].hash).to.equal((await c.getRecord(i)).hash);
      }
    });

    it("clamps the last page to what is available", async () => {
      const page = await c.getRecords(3, 10);
      expect(page.map((r) => r.index)).to.deep.equal([3n, 4n]);
    });

    it("returns an empty page for an out-of-range offset and handles a huge limit", async () => {
      expect(await c.getRecords(5, 10)).to.have.lengthOf(0);
      expect(await c.getRecords(999, 10)).to.have.lengthOf(0);
      expect(await c.getRecords(0, ethers.MaxUint256)).to.have.lengthOf(5);
    });

    it("returns an empty page for limit 0", async () => {
      expect(await c.getRecords(0, 0)).to.have.lengthOf(0);
    });

    it("returns nothing for an empty ledger", async () => {
      const fresh = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
      expect(await fresh.getRecords(0, 10)).to.have.lengthOf(0);
    });
  });

  describe("getProducts", () => {
    beforeEach(async () => {
      for (const name of ["Laptop", "Phone", "Tablet"]) await c.registerProduct(name);
    });

    it("lists products in id order starting at #1", async () => {
      const page = await c.getProducts(0, 10);
      expect(page.map((p) => p.id)).to.deep.equal([1n, 2n, 3n]);
      expect(page.map((p) => p.name)).to.deep.equal(["Laptop", "Phone", "Tablet"]);
      expect(page[0].owner).to.equal(owner.address);
    });

    it("honours offset and limit", async () => {
      const page = await c.getProducts(1, 1);
      expect(page.map((p) => p.name)).to.deep.equal(["Phone"]);
    });

    it("clamps, and returns empty past the end", async () => {
      expect(await c.getProducts(2, 10)).to.have.lengthOf(1);
      expect(await c.getProducts(3, 10)).to.have.lengthOf(0);
      expect(await c.getProducts(0, ethers.MaxUint256)).to.have.lengthOf(3);
    });

    it("reflects current price and owner", async () => {
      await c.listForSale(2, price);
      expect((await c.getProducts(1, 1))[0].price).to.equal(price);
    });
  });
});
