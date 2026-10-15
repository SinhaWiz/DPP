// Every way an escrow purchase can end, so the trail shows Reserved → Sold and Reserved → Revoked.
const { ethers } = require("hardhat");

module.exports = {
  name: "escrowRevocations",
  description: "Reservations that are confirmed, cancelled by the buyer, rejected by the seller and expired.",
  async run(ctx) {
    const { log, as, market, manufacturer, distributor, retailer, customer, outsider, eth } = ctx;
    const out = {};

    // 1. Phone: delist, relist, buyer revokes, a second buyer completes the sale.
    out.phone = await ctx.nextProductId();
    log(`▶ Phone (#${out.phone}): list → delist → relist → reserve → buyer revokes → reserve → confirm`);
    await (await as(manufacturer).registerProduct("Phone")).wait();
    await (await as(manufacturer).listForSale(out.phone, eth("2"))).wait();
    await (await as(manufacturer).cancelListing(out.phone)).wait();
    await (await as(manufacturer).listForSale(out.phone, eth("2"))).wait();
    await (await as(distributor).reserve(out.phone, { value: eth("2") })).wait();
    await (await as(distributor).revokeReservation(out.phone)).wait();
    await (await as(retailer).reserve(out.phone, { value: eth("2") })).wait();
    await (await as(manufacturer).confirmSale(out.phone)).wait();

    // 2. Tablet: the seller rejects.
    out.tablet = await ctx.nextProductId();
    log(`▶ Tablet (#${out.tablet}): reserve → seller rejects`);
    await (await as(manufacturer).registerProduct("Tablet")).wait();
    await (await as(manufacturer).listForSale(out.tablet, eth("1.2"))).wait();
    await (await as(customer).reserve(out.tablet, { value: eth("1.2") })).wait();
    await (await as(manufacturer).rejectReservation(out.tablet)).wait();

    // 3. Watch: nobody answers, so an outsider expires the reservation after a day.
    out.watch = await ctx.nextProductId();
    log(`▶ Watch (#${out.watch}): reserve → one day passes → anyone expires it`);
    await (await as(manufacturer).registerProduct("Watch")).wait();
    await (await as(manufacturer).listForSale(out.watch, eth("0.5"))).wait();
    await (await as(customer).reserve(out.watch, { value: eth("0.5") })).wait();
    const period = Number(await market.RESERVATION_PERIOD());
    await ethers.provider.send("evm_increaseTime", [period + 1]);
    await ethers.provider.send("evm_mine", []);
    await (await as(outsider).expireReservation(out.watch)).wait();

    // 4. Money moves with pull payments.
    log("▶ Seller and refunded buyers withdraw");
    await (await as(manufacturer).withdraw()).wait();
    await (await as(distributor).withdraw()).wait();
    await (await as(customer).withdraw()).wait();
    return out;
  },
};
