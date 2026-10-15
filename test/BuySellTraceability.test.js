const { expect } = require("chai");
const { ethers } = require("hardhat");
const { tamperWithPrice } = require("./helpers/tamper");

const Action = { Registered: 0n, Listed: 1n, Delisted: 2n, Sold: 3n };
const PAGE = 100; // large enough to fetch a whole history in one call

describe("BuySellTraceability", () => {
  let c, manufacturer, distributor, retailer, customer;
  const price = ethers.parseEther("1");

  beforeEach(async () => {
    [manufacturer, distributor, retailer, customer] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
    await c.connect(manufacturer).registerProduct("Laptop");
  });

  describe("register / list / cancel", () => {
    it("registers a product with the caller as owner", async () => {
      const p = await c.getProduct(1);
      expect(p.name).to.equal("Laptop");
      expect(p.owner).to.equal(manufacturer.address);
      expect(p.price).to.equal(0n);
      expect(await c.isForSale(1)).to.equal(false);
    });

    it("rejects empty names", async () => {
      await expect(c.registerProduct("")).to.be.revertedWithCustomError(c, "EmptyName");
    });

    it("only the owner can list, and price must be > 0", async () => {
      await expect(c.connect(customer).listForSale(1, price))
        .to.be.revertedWithCustomError(c, "NotProductOwner")
        .withArgs(1, customer.address);
      await expect(c.listForSale(1, 0)).to.be.revertedWithCustomError(c, "InvalidPrice");
    });

    it("listing sets the price and marks the product for sale", async () => {
      await c.listForSale(1, price);
      expect(await c.isForSale(1)).to.equal(true);
      expect((await c.getProduct(1)).price).to.equal(price);
    });

    it("owner can cancel a listing", async () => {
      await c.listForSale(1, price);
      await c.cancelListing(1);
      expect(await c.isForSale(1)).to.equal(false);
      await expect(c.cancelListing(1)).to.be.revertedWithCustomError(c, "NotListed").withArgs(1);
    });

    it("reverts for unknown products", async () => {
      await expect(c.getProduct(99)).to.be.revertedWithCustomError(c, "ProductNotFound").withArgs(99);
      await expect(c.isForSale(99)).to.be.revertedWithCustomError(c, "ProductNotFound");
      await expect(c.listForSale(0, price)).to.be.revertedWithCustomError(c, "ProductNotFound");
      await expect(c.buy(99)).to.be.revertedWithCustomError(c, "ProductNotFound");
    });
  });

  describe("buy", () => {
    beforeEach(async () => {
      await c.connect(manufacturer).listForSale(1, price);
    });

    it("transfers ownership and pays the seller", async () => {
      await expect(c.connect(distributor).buy(1, { value: price })).to.changeEtherBalances(
        [distributor, manufacturer],
        [-price, price]
      );
      const p = await c.getProduct(1);
      expect(p.owner).to.equal(distributor.address);
      expect(await c.isForSale(1)).to.equal(false);
    });

    it("rejects wrong payment, self-purchase and unlisted products", async () => {
      await expect(c.connect(distributor).buy(1, { value: price - 1n }))
        .to.be.revertedWithCustomError(c, "IncorrectPayment")
        .withArgs(price, price - 1n);
      await expect(c.connect(manufacturer).buy(1, { value: price }))
        .to.be.revertedWithCustomError(c, "CannotBuyOwnProduct")
        .withArgs(1);
      await c.connect(distributor).buy(1, { value: price });
      await expect(c.connect(retailer).buy(1, { value: price }))
        .to.be.revertedWithCustomError(c, "NotListed")
        .withArgs(1);
    });

    it("previous owner can no longer list", async () => {
      await c.connect(distributor).buy(1, { value: price });
      await expect(c.connect(manufacturer).listForSale(1, price)).to.be.revertedWithCustomError(
        c,
        "NotProductOwner"
      );
    });

    it("reverts the whole sale if the seller cannot receive ETH", async () => {
      const rejecter = await (await ethers.getContractFactory("EtherRejecter")).deploy();
      await rejecter.registerOn(await c.getAddress());
      await rejecter.list(await c.getAddress(), 2, price);
      await expect(c.connect(distributor).buy(2, { value: price })).to.be.revertedWithCustomError(
        c,
        "PaymentFailed"
      );
      expect((await c.getProduct(2)).owner).to.equal(await rejecter.getAddress());
    });
  });

  describe("traceability", () => {
    async function runSupplyChain() {
      await c.connect(manufacturer).listForSale(1, price);
      await c.connect(distributor).buy(1, { value: price });
      await c.connect(distributor).listForSale(1, price * 2n);
      await c.connect(retailer).buy(1, { value: price * 2n });
      await c.connect(retailer).listForSale(1, price * 3n);
      await c.connect(customer).buy(1, { value: price * 3n });
    }

    it("records the complete ownership trail in order", async () => {
      await runSupplyChain();
      const h = await c.getProductHistory(1, 0, PAGE);
      expect(h.map((r) => r.action)).to.deep.equal([
        Action.Registered, Action.Listed, Action.Sold,
        Action.Listed, Action.Sold, Action.Listed, Action.Sold,
      ]);
      const sales = h.filter((r) => r.action === Action.Sold);
      expect(sales.map((r) => r.actor)).to.deep.equal([manufacturer.address, distributor.address, retailer.address]);
      expect(sales.map((r) => r.counterparty)).to.deep.equal([distributor.address, retailer.address, customer.address]);
      expect((await c.getProduct(1)).owner).to.equal(customer.address);
    });

    it("uses the zero address as counterparty for non-sale records", async () => {
      await c.listForSale(1, price);
      const h = await c.getProductHistory(1, 0, PAGE);
      expect(h.filter((r) => r.action !== Action.Sold).map((r) => r.counterparty)).to.deep.equal([
        ethers.ZeroAddress, ethers.ZeroAddress,
      ]);
    });

    it("links every record to the previous one by hash", async () => {
      await runSupplyChain();
      const n = await c.ledgerLength();
      expect((await c.getRecord(0)).prevHash).to.equal(ethers.ZeroHash);
      for (let i = 1n; i < n; i++) {
        expect((await c.getRecord(i)).prevHash).to.equal((await c.getRecord(i - 1n)).hash);
      }
    });

    it("recomputed hash matches the stored hash (off-chain verification)", async () => {
      await runSupplyChain();
      const r = await c.getRecord(2);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      const expected = ethers.keccak256(
        coder.encode(
          ["uint256", "uint256", "uint256", "uint8", "address", "address", "uint256", "bytes32"],
          [r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash]
        )
      );
      expect(r.hash).to.equal(expected);
    });

    it("verifyLedger reports an intact chain", async () => {
      await runSupplyChain();
      const [valid] = await c.verifyLedger();
      expect(valid).to.equal(true);
    });

    it("verifyLedger detects tampering with a stored record", async () => {
      await runSupplyChain();
      await tamperWithPrice(c, 2);
      const [valid, brokenAt] = await c.verifyLedger();
      expect(valid).to.equal(false);
      expect(brokenAt).to.equal(2n);
    });

    it("keeps separate trails per product", async () => {
      await c.connect(retailer).registerProduct("Phone");
      expect(await c.getProductHistoryLength(1)).to.equal(1n);
      expect(await c.getProductHistoryLength(2)).to.equal(1n);
      expect(await c.ledgerLength()).to.equal(2n);
    });

    it("reverts when asking for the history of an unknown product", async () => {
      await expect(c.getProductHistory(99, 0, PAGE)).to.be.revertedWithCustomError(c, "ProductNotFound");
      await expect(c.getProductHistoryLength(99)).to.be.revertedWithCustomError(c, "ProductNotFound");
    });

    it("reverts for an unknown record index", async () => {
      await expect(c.getRecord(5)).to.be.revertedWithCustomError(c, "RecordNotFound").withArgs(5);
    });
  });

  describe("pagination", () => {
    beforeEach(async () => {
      // product 1 gets 1 (Registered) + 4 (Listed x4 price changes) = 5 records
      for (let i = 1n; i <= 4n; i++) await c.listForSale(1, price * i);
    });

    it("returns the requested window", async () => {
      expect(await c.getProductHistoryLength(1)).to.equal(5n);
      const page = await c.getProductHistory(1, 1, 2);
      expect(page.map((r) => r.index)).to.deep.equal([1n, 2n]);
    });

    it("clamps the last page to what is available", async () => {
      const page = await c.getProductHistory(1, 3, 10);
      expect(page.map((r) => r.index)).to.deep.equal([3n, 4n]);
    });

    it("returns an empty page for an out-of-range offset and handles a huge limit", async () => {
      expect(await c.getProductHistory(1, 5, 10)).to.have.lengthOf(0);
      expect(await c.getProductHistory(1, 0, ethers.MaxUint256)).to.have.lengthOf(5);
    });
  });

  describe("verifyRange", () => {
    beforeEach(async () => {
      for (let i = 1n; i <= 4n; i++) await c.listForSale(1, price * i); // 5 records
    });

    it("accepts intact sub-ranges, including a mid-chain start and an empty range", async () => {
      expect((await c.verifyRange(0, 5))[0]).to.equal(true);
      expect((await c.verifyRange(2, 4))[0]).to.equal(true);
      expect((await c.verifyRange(3, 3))[0]).to.equal(true);
    });

    it("only flags tampering inside the verified range", async () => {
      await tamperWithPrice(c, 3);
      expect((await c.verifyRange(0, 3))[0]).to.equal(true);
      const [valid, brokenAt] = await c.verifyRange(2, 5);
      expect(valid).to.equal(false);
      expect(brokenAt).to.equal(3n);
    });

    it("rejects invalid ranges", async () => {
      await expect(c.verifyRange(3, 2)).to.be.revertedWithCustomError(c, "InvalidRange").withArgs(3, 2);
      await expect(c.verifyRange(0, 6)).to.be.revertedWithCustomError(c, "InvalidRange").withArgs(0, 6);
    });
  });
});
