const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { recomputeHash } = require("./helpers/tamper");

const Action = { Registered: 0n, Listed: 1n, Delisted: 2n, Sold: 3n, Reserved: 4n, Revoked: 5n };
const Reason = { BuyerCancelled: 0n, SellerRejected: 1n, Expired: 2n };
const DAY = 24 * 60 * 60;

describe("escrow purchases", () => {
  let c, seller, buyer, other;
  const price = ethers.parseEther("1");

  beforeEach(async () => {
    [seller, buyer, other] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
    await c.registerProduct("Laptop");
    await c.listForSale(1, price);
  });

  const actions = async () => (await c.getRecords(0, 100)).map((r) => r.action);

  describe("reserve", () => {
    it("locks the product, holds the ETH and writes a Reserved record", async () => {
      const tx = await c.connect(buyer).reserve(1, { value: price });
      const at = await time.latest();

      expect(await c.isReserved(1)).to.equal(true);
      const r = await c.getReservation(1);
      expect(r.buyer).to.equal(buyer.address);
      expect(r.amount).to.equal(price);
      expect(r.expiresAt).to.equal(BigInt(at + DAY));
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(price);

      const rec = await c.getRecord(2);
      expect(rec.action).to.equal(Action.Reserved);
      expect(rec.actor).to.equal(buyer.address);
      expect(rec.counterparty).to.equal(seller.address);
      expect(rec.price).to.equal(price);
      await expect(tx).to.emit(c, "ReservationCreated").withArgs(1, buyer.address, price, BigInt(at + DAY));
    });

    it("keeps ownership with the seller until confirmation", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      expect((await c.getProduct(1)).owner).to.equal(seller.address);
    });

    it("applies the same purchase rules as buy()", async () => {
      await expect(c.reserve(1, { value: price })).to.be.revertedWithCustomError(c, "CannotBuyOwnProduct");
      await expect(c.connect(buyer).reserve(1, { value: price - 1n }))
        .to.be.revertedWithCustomError(c, "IncorrectPayment").withArgs(price, price - 1n);
      await c.cancelListing(1);
      await expect(c.connect(buyer).reserve(1, { value: price })).to.be.revertedWithCustomError(c, "NotListed");
      await expect(c.connect(buyer).reserve(99, { value: price })).to.be.revertedWithCustomError(c, "ProductNotFound");
    });

    it("rejects a second reservation while one is active", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await expect(c.connect(other).reserve(1, { value: price }))
        .to.be.revertedWithCustomError(c, "ProductReserved").withArgs(1);
    });
  });

  describe("locks on the other paths", () => {
    beforeEach(async () => {
      await c.connect(buyer).reserve(1, { value: price });
    });

    it("blocks listForSale, cancelListing and instant buy", async () => {
      await expect(c.listForSale(1, price * 2n)).to.be.revertedWithCustomError(c, "ProductReserved");
      await expect(c.cancelListing(1)).to.be.revertedWithCustomError(c, "ProductReserved");
      await expect(c.connect(other).buy(1, { value: price })).to.be.revertedWithCustomError(c, "ProductReserved");
    });

    it("unlocks again after the reservation ends", async () => {
      await c.rejectReservation(1);
      await c.cancelListing(1);
      await c.listForSale(1, price * 2n);
    });
  });

  describe("confirmSale", () => {
    beforeEach(async () => {
      await c.connect(buyer).reserve(1, { value: price });
    });

    it("transfers ownership, ends the listing and credits the seller", async () => {
      const tx = await c.confirmSale(1);
      const p = await c.getProduct(1);
      expect(p.owner).to.equal(buyer.address);
      expect(p.price).to.equal(0n);
      expect(await c.isReserved(1)).to.equal(false);
      expect(await c.pendingWithdrawals(seller.address)).to.equal(price);

      const rec = await c.getRecord(3);
      expect(rec.action).to.equal(Action.Sold);
      expect(rec.actor).to.equal(seller.address);
      expect(rec.counterparty).to.equal(buyer.address);
      expect(rec.price).to.equal(price);
      await expect(tx).to.emit(c, "SaleConfirmed").withArgs(1, seller.address, buyer.address, price);
      await expect(tx).to.emit(c, "ProductSold").withArgs(1, seller.address, buyer.address, price);
    });

    it("lets the seller withdraw the proceeds exactly once", async () => {
      await c.confirmSale(1);
      await expect(c.withdraw()).to.changeEtherBalance(seller, price);
      expect(await c.pendingWithdrawals(seller.address)).to.equal(0n);
      await expect(c.withdraw()).to.be.revertedWithCustomError(c, "NothingToWithdraw").withArgs(seller.address);
    });

    it("writes the same trail shape as an instant sale", async () => {
      await c.confirmSale(1);
      expect(await actions()).to.deep.equal([Action.Registered, Action.Listed, Action.Reserved, Action.Sold]);
    });

    it("only the owner may confirm, and only a live reservation", async () => {
      await expect(c.connect(other).confirmSale(1)).to.be.revertedWithCustomError(c, "NotProductOwner");
      await c.confirmSale(1);
      await c.connect(buyer).listForSale(1, price);
      await expect(c.connect(buyer).confirmSale(1)).to.be.revertedWithCustomError(c, "NotReserved").withArgs(1);
    });

    it("cannot be confirmed after the reservation period", async () => {
      await time.increase(DAY + 1);
      const r = await c.getReservation(1);
      await expect(c.confirmSale(1)).to.be.revertedWithCustomError(c, "ReservationExpired").withArgs(1, r.expiresAt);
    });
  });

  describe("revocation", () => {
    beforeEach(async () => {
      await c.connect(buyer).reserve(1, { value: price });
    });

    it("buyer cancels: Revoked record by the buyer, refund credited to the buyer", async () => {
      const tx = await c.connect(buyer).revokeReservation(1);
      const rec = await c.getRecord(3);
      expect(rec.action).to.equal(Action.Revoked);
      expect(rec.actor).to.equal(buyer.address);
      expect(rec.counterparty).to.equal(seller.address);
      expect(rec.price).to.equal(price);
      await expect(tx).to.emit(c, "ReservationRevoked")
        .withArgs(1, buyer.address, buyer.address, price, Reason.BuyerCancelled);

      expect(await c.isReserved(1)).to.equal(false);
      expect((await c.getProduct(1)).owner).to.equal(seller.address);
      expect((await c.getProduct(1)).price).to.equal(price); // still listed
      await expect(c.connect(buyer).withdraw()).to.changeEtherBalance(buyer, price);
    });

    it("seller rejects: Revoked record by the seller", async () => {
      const tx = await c.rejectReservation(1);
      const rec = await c.getRecord(3);
      expect(rec.action).to.equal(Action.Revoked);
      expect(rec.actor).to.equal(seller.address);
      expect(rec.counterparty).to.equal(buyer.address);
      await expect(tx).to.emit(c, "ReservationRevoked")
        .withArgs(1, seller.address, buyer.address, price, Reason.SellerRejected);
      await expect(c.connect(buyer).withdraw()).to.changeEtherBalance(buyer, price);
    });

    it("expiry: anyone may end it after the period, not before", async () => {
      const r = await c.getReservation(1);
      await expect(c.connect(other).expireReservation(1))
        .to.be.revertedWithCustomError(c, "ReservationNotExpired").withArgs(1, r.expiresAt);

      await time.increase(DAY + 1);
      const tx = await c.connect(other).expireReservation(1);
      const rec = await c.getRecord(3);
      expect(rec.action).to.equal(Action.Revoked);
      expect(rec.actor).to.equal(other.address);
      expect(rec.counterparty).to.equal(buyer.address);
      await expect(tx).to.emit(c, "ReservationRevoked")
        .withArgs(1, other.address, buyer.address, price, Reason.Expired);
      await expect(c.connect(buyer).withdraw()).to.changeEtherBalance(buyer, price);
    });

    it("only the reserving buyer may revoke; only the owner may reject", async () => {
      await expect(c.connect(other).revokeReservation(1))
        .to.be.revertedWithCustomError(c, "NotReservationBuyer").withArgs(1, other.address);
      await expect(c.connect(other).rejectReservation(1)).to.be.revertedWithCustomError(c, "NotProductOwner");
    });

    it("rejects revocation paths when there is no reservation", async () => {
      await c.connect(buyer).revokeReservation(1);
      await expect(c.connect(buyer).revokeReservation(1)).to.be.revertedWithCustomError(c, "NotReserved");
      await expect(c.rejectReservation(1)).to.be.revertedWithCustomError(c, "NotReserved");
      await expect(c.expireReservation(1)).to.be.revertedWithCustomError(c, "NotReserved");
    });

    it("lets a revoked product be reserved again by someone else", async () => {
      await c.connect(buyer).revokeReservation(1);
      await c.connect(other).reserve(1, { value: price });
      await c.confirmSale(1);
      expect((await c.getProduct(1)).owner).to.equal(other.address);
      expect(await actions()).to.deep.equal([
        Action.Registered, Action.Listed, Action.Reserved, Action.Revoked, Action.Reserved, Action.Sold,
      ]);
    });
  });

  describe("withdraw", () => {
    it("reverts with nothing to withdraw", async () => {
      await expect(c.connect(other).withdraw()).to.be.revertedWithCustomError(c, "NothingToWithdraw");
    });

    it("accumulates credits across several sales", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await c.confirmSale(1);
      await c.connect(buyer).listForSale(1, price * 2n);
      await c.connect(other).reserve(1, { value: price * 2n });
      await c.connect(buyer).confirmSale(1);
      expect(await c.pendingWithdrawals(seller.address)).to.equal(price);
      expect(await c.pendingWithdrawals(buyer.address)).to.equal(price * 2n);
      await expect(c.connect(buyer).withdraw()).to.emit(c, "Withdrawn").withArgs(buyer.address, price * 2n);
    });

    it("never lets the contract balance fall below what it owes", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await c.connect(buyer).revokeReservation(1);
      const owed = await c.pendingWithdrawals(buyer.address);
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(owed);
    });
  });

  describe("pull vs push payment", () => {
    it("a seller that refuses ETH blocks an instant buy but not an escrow sale", async () => {
      const Rejecter = await ethers.getContractFactory("EtherRejecter");
      const rejecter = await Rejecter.deploy();
      await rejecter.registerOn(await c.getAddress());           // product #2, owned by the rejecter
      await rejecter.list(await c.getAddress(), 2, price);

      // push payment: the whole sale reverts
      await expect(c.connect(buyer).buy(2, { value: price }))
        .to.be.revertedWithCustomError(c, "PaymentFailed");
      expect((await c.getProduct(2)).owner).to.equal(await rejecter.getAddress());

      // pull payment: reserving works and the rejecter can't confirm (it has no such function),
      // but the buyer's deposit is never stranded
      await c.connect(buyer).reserve(2, { value: price });
      await time.increase(DAY + 1);
      await c.expireReservation(2);
      await expect(c.connect(buyer).withdraw()).to.changeEtherBalance(buyer, price);
    });

    it("a contract that refuses ETH can't withdraw, and its credit stays safe", async () => {
      const Rejecter = await ethers.getContractFactory("EtherRejecter");
      const rejecter = await Rejecter.deploy();
      const market = await c.getAddress();
      const who = await rejecter.getAddress();

      await rejecter.reserveOn(market, 1, { value: price });
      await c.rejectReservation(1);                     // refund is credited, not pushed
      expect(await c.pendingWithdrawals(who)).to.equal(price);

      await expect(rejecter.withdrawFrom(market))
        .to.be.revertedWithCustomError(c, "WithdrawFailed").withArgs(who);
      expect(await c.pendingWithdrawals(who)).to.equal(price); // still owed, nothing lost
    });
  });

  describe("reentrancy", () => {
    it("a re-entering receiver is paid once", async () => {
      const Attacker = await ethers.getContractFactory("ReentrantWithdrawer");
      const attacker = await Attacker.deploy(await c.getAddress());
      await attacker.registerAndList(price);                       // product #2
      await c.connect(buyer).reserve(2, { value: price });
      await attacker.confirm(2);

      const before = await ethers.provider.getBalance(await c.getAddress());
      await attacker.attack();
      expect(await attacker.reentries()).to.equal(1n);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(before - price);
      expect(await c.pendingWithdrawals(await attacker.getAddress())).to.equal(0n);
    });
  });

  describe("ledger integrity", () => {
    it("keeps the hash chain valid across every escrow action", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await c.connect(buyer).revokeReservation(1);
      await c.connect(other).reserve(1, { value: price });
      await time.increase(DAY + 1);
      await c.expireReservation(1);
      await c.connect(buyer).reserve(1, { value: price });
      await c.confirmSale(1);

      expect((await c.verifyLedger())[0]).to.equal(true);
      expect((await c.auditRange(0, await c.ledgerLength()))[0]).to.have.lengthOf(0);
    });

    it("matches the off-chain hash recipe for the new actions (enum values 4 and 5)", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await c.connect(buyer).revokeReservation(1);
      for (const i of [2, 3]) {
        expect(await recomputeHash(c, i)).to.equal((await c.getRecord(i)).hash);
      }
    });

    it("records the full story of a revoked purchase in the product trail", async () => {
      await c.connect(buyer).reserve(1, { value: price });
      await c.connect(buyer).revokeReservation(1);
      const trail = await c.getProductHistory(1, 0, 100);
      expect(trail.map((r) => r.action)).to.deep.equal([
        Action.Registered, Action.Listed, Action.Reserved, Action.Revoked,
      ]);
    });
  });
});
