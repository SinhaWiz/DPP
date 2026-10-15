// Triggers every custom error of the market contract. Each failing call is sent with an explicit
// gas limit, so on a node started with DEV_NODE=1 it is mined with status 0 and keeps its hash.
const { ethers } = require("hardhat");
const { attempt, FORCE } = require("./context");

module.exports = {
  name: "everyError",
  description: "Sends one deliberately failing transaction for each custom error.",
  async run(ctx) {
    const { log, as, market, rejecter, manufacturer, distributor, retailer, customer, outsider, eth } = ctx;
    const results = [];
    const fail = async (label, send) => results.push(await attempt(label, send, log));

    // Fresh products so this scenario works on any chain state.
    const own = await ctx.nextProductId();        // listed, owned by the manufacturer
    await (await as(manufacturer).registerProduct("Error demo: listed")).wait();
    await (await as(manufacturer).listForSale(own, eth("1"))).wait();
    const unlisted = await ctx.nextProductId();   // never listed
    await (await as(manufacturer).registerProduct("Error demo: unlisted")).wait();

    log("▶ Deliberately failing transactions");
    await fail("EmptyName: register with an empty name", () => as(outsider).registerProduct("", FORCE));
    await fail("InvalidPrice: list at price 0", () => as(manufacturer).listForSale(unlisted, 0, FORCE));
    await fail("ProductNotFound: buy a product that doesn't exist", () => as(customer).buy(99999, { ...FORCE, value: eth("1") }));
    await fail("NotProductOwner: an outsider lists someone else's product", () => as(outsider).listForSale(unlisted, eth("1"), FORCE));
    await fail("NotListed: buy a product that isn't for sale", () => as(customer).buy(unlisted, { ...FORCE, value: eth("1") }));
    await fail("CannotBuyOwnProduct: the owner buys their own product", () => as(manufacturer).buy(own, { ...FORCE, value: eth("1") }));
    await fail("IncorrectPayment: pay 0.5 ETH for a 1 ETH product", () => as(customer).buy(own, { ...FORCE, value: eth("0.5") }));

    if (rejecter) {
      const rejecterProduct = await ctx.nextProductId();
      await (await rejecter.registerOn(await market.getAddress())).wait();
      await (await rejecter.list(await market.getAddress(), rejecterProduct, eth("1"))).wait();
      await fail("PaymentFailed: the seller is a contract that refuses ETH", () => as(customer).buy(rejecterProduct, { ...FORCE, value: eth("1") }));
    }

    // Escrow errors.
    await (await as(distributor).reserve(own, { value: eth("1") })).wait();
    await fail("ProductReserved: list a product that is reserved", () => as(manufacturer).listForSale(own, eth("2"), FORCE));
    await fail("NotReservationBuyer: someone else revokes the reservation", () => as(retailer).revokeReservation(own, FORCE));
    await fail("ReservationNotExpired: expire a reservation too early", () => as(outsider).expireReservation(own, FORCE));
    await fail("NotReserved: confirm a product nobody reserved", () => as(manufacturer).confirmSale(unlisted, FORCE));
    await fail("NothingToWithdraw: withdraw with no balance", () => as(outsider).withdraw(FORCE));
    await (await as(distributor).revokeReservation(own)).wait(); // tidy up: refund is now pending

    // The seller answers too late.
    const late = await ctx.nextProductId();
    await (await as(manufacturer).registerProduct("Error demo: answered too late")).wait();
    await (await as(manufacturer).listForSale(late, eth("1"))).wait();
    await (await as(customer).reserve(late, { value: eth("1") })).wait();
    await ethers.provider.send("evm_increaseTime", [Number(await market.RESERVATION_PERIOD()) + 1]);
    await ethers.provider.send("evm_mine", []);
    await fail("ReservationExpired: the seller confirms after the period", () => as(manufacturer).confirmSale(late, FORCE));
    await (await as(outsider).expireReservation(late)).wait(); // tidy up: refund is now pending

    if (rejecter) {
      // The rejecter reserves, gets refunded as a credit, and then cannot receive it.
      const listed = await ctx.nextProductId();
      await (await as(manufacturer).registerProduct("Error demo: for the rejecter")).wait();
      await (await as(manufacturer).listForSale(listed, eth("1"))).wait();
      const marketAddress = await market.getAddress();
      await (await rejecter.reserveOn(marketAddress, listed, { value: eth("1") })).wait();
      await (await as(manufacturer).rejectReservation(listed)).wait();
      await fail("WithdrawFailed: a contract that refuses ETH tries to withdraw", () => rejecter.withdrawFrom(marketAddress, FORCE));
    }

    const mined = results.filter((r) => r.hash).length;
    log(`  ${results.length} failing attempts, ${mined} mined with status 0`);
    return { results };
  },
};
