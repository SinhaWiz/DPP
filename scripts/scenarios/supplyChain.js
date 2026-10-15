// Manufacturer → Distributor → Retailer → Customer, one laptop, three instant sales.
module.exports = {
  name: "supplyChain",
  description: "A laptop travels from manufacturer to customer through three instant sales.",
  async run(ctx, { productName = "Laptop" } = {}) {
    const { log, as, manufacturer, distributor, retailer, customer, eth } = ctx;

    const productId = await ctx.nextProductId();
    log(`▶ Manufacturer registers '${productName}' (#${productId})`);
    await (await as(manufacturer).registerProduct(productName)).wait();

    const hops = [
      [manufacturer, "Manufacturer", distributor, "Distributor", "1.0"],
      [distributor, "Distributor", retailer, "Retailer", "1.5"],
      [retailer, "Retailer", customer, "Customer", "2.0"],
    ];
    for (const [seller, from, buyer, to, price] of hops) {
      log(`▶ ${from} lists for ${price} ETH, ${to} buys`);
      await (await as(seller).listForSale(productId, eth(price))).wait();
      await (await as(buyer).buy(productId, { value: eth(price) })).wait();
    }
    return { productId };
  },
};
