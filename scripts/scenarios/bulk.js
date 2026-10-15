// Many records quickly, for performance tests of the indexer and the chain view.
module.exports = {
  name: "bulk",
  description: "Registers and lists N products (2 records each).",
  async run(ctx, { count = 50 } = {}) {
    const { log, as, manufacturer, eth } = ctx;
    log(`▶ Creating ${count} products`);
    for (let i = 1; i <= count; i++) {
      const id = await ctx.nextProductId();
      await (await as(manufacturer).registerProduct(`Item ${id}`)).wait();
      await (await as(manufacturer).listForSale(id, eth("0.01"))).wait();
    }
    return { count, records: count * 2 };
  },
};
