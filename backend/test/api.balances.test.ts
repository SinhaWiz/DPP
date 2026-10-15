import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BalanceListSchema } from "@dpp/shared";
import { Contract } from "ethers";
import { startHarness, eth, type Harness } from "./helpers";

describe("GET /api/balances", () => {
  let h: Harness;
  const balances = async () => BalanceListSchema.parse((await h.get("/api/balances")).body);
  const of = (b: Awaited<ReturnType<typeof balances>>, name: string) => b.balances.find((x) => x.name === name)!;

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");
    await h.call(0, "listForSale", 1, eth("1"));
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  it("starts with nobody owed anything and an empty contract", async () => {
    const b = await balances();
    expect(b.balances.map((x) => x.name)).toEqual(["Manufacturer", "Distributor", "Retailer", "Customer", "Outsider", "Broken Wallet"]);
    expect(b.balances.every((x) => x.withdrawable === "0")).toBe(true);
    expect(b.contractBalance).toBe("0");
    expect(BigInt(of(b, "Manufacturer").balance)).toBeGreaterThan(0n);
  });

  it("holds a reservation's deposit in the contract, owed to nobody yet", async () => {
    await h.call(1, "reserve", 1, { value: eth("1") });
    const b = await balances();
    expect(b.contractBalance).toBe(eth("1").toString());
    expect(b.balances.every((x) => x.withdrawable === "0")).toBe(true);
  });

  it("owes the seller after the sale is confirmed, and the money stays in the contract until pulled", async () => {
    await h.call(0, "confirmSale", 1);
    const b = await balances();
    expect(of(b, "Manufacturer").withdrawable).toBe(eth("1").toString());
    expect(b.contractBalance).toBe(eth("1").toString());
  });

  it("goes back to zero once the seller withdraws", async () => {
    await h.call(0, "withdraw");
    const b = await balances();
    expect(of(b, "Manufacturer").withdrawable).toBe("0");
    expect(b.contractBalance).toBe("0");
  });

  it("owes the buyer a refund after a revoked reservation", async () => {
    await h.call(1, "listForSale", 1, eth("2"));
    await h.call(2, "reserve", 1, { value: eth("2") });
    await h.call(1, "rejectReservation", 1);
    expect(of(await balances(), "Retailer").withdrawable).toBe(eth("2").toString());
  });

  it("shows a refund owed to the Broken Wallet, which can never pull it, while everyone else is unaffected", async () => {
    const market = await h.deployed.market.getAddress();
    const rejecter = h.deployed.rejecter.connect(h.deployed.signers[0]!) as Contract;
    const before = await balances();

    // product 1 is listed at 2 ETH by the Distributor; the Broken Wallet reserves it and the seller declines
    await (await rejecter.getFunction("reserveOn")(market, 1, { value: eth("2") })).wait();
    await h.call(1, "rejectReservation", 1);
    let b = await balances();
    expect(of(b, "Broken Wallet").withdrawable).toBe(eth("2").toString());
    expect(of(b, "Retailer").withdrawable).toBe(of(before, "Retailer").withdrawable); // untouched

    // it cannot withdraw: the refund is still there afterwards, nothing was lost
    const tx = await rejecter.getFunction("withdrawFrom")(market, { gasLimit: 400_000 });
    await tx.wait().catch(() => undefined);
    b = await balances();
    expect(of(b, "Broken Wallet").withdrawable).toBe(eth("2").toString());
    expect(BigInt(b.contractBalance)).toBeGreaterThanOrEqual(eth("2"));
  });

  it("is empty before any deployment is known", async () => {
    h.services.indexer.getDeployment = () => null;
    const b = BalanceListSchema.parse((await h.get("/api/balances")).body);
    expect(b).toEqual({ balances: [], contractBalance: "0" });
  });
});
