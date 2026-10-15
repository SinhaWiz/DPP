const { expect } = require("chai");
const { ethers } = require("hardhat");
const { runScenario } = require("../scripts/scenarios");

const Action = { Registered: 0n, Listed: 1n, Delisted: 2n, Sold: 3n, Reserved: 4n, Revoked: 5n };

describe("scenarios", () => {
  let market, rejecter, signers, deps;

  beforeEach(async () => {
    signers = await ethers.getSigners();
    market = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
    rejecter = await (await ethers.getContractFactory("EtherRejecter")).deploy();
    deps = { market, rejecter, signers, log: () => {} };
  });

  const actionsOf = async (id) => (await market.getProductHistory(id, 0, 100)).map((r) => r.action);

  it("supplyChain ends with the customer owning a fully traced laptop", async () => {
    const { productId } = await runScenario("supplyChain", deps);
    expect((await market.getProduct(productId)).owner).to.equal(signers[3].address);
    expect(await actionsOf(productId)).to.deep.equal([
      Action.Registered, Action.Listed, Action.Sold, Action.Listed, Action.Sold, Action.Listed, Action.Sold,
    ]);
    expect((await market.verifyLedger())[0]).to.equal(true);
  });

  it("escrowRevocations leaves a trail with confirmed, rejected and expired reservations", async () => {
    const { phone, tablet, watch } = await runScenario("escrowRevocations", deps);
    expect(await actionsOf(phone)).to.deep.equal([
      Action.Registered, Action.Listed, Action.Delisted, Action.Listed,
      Action.Reserved, Action.Revoked, Action.Reserved, Action.Sold,
    ]);
    expect(await actionsOf(tablet)).to.deep.equal([Action.Registered, Action.Listed, Action.Reserved, Action.Revoked]);
    expect(await actionsOf(watch)).to.deep.equal([Action.Registered, Action.Listed, Action.Reserved, Action.Revoked]);
    for (const s of signers.slice(0, 5)) expect(await market.pendingWithdrawals(s.address)).to.equal(0n);
    expect((await market.verifyLedger())[0]).to.equal(true);
  });

  it("everyError attempts a failure for each custom error and records nothing for them", async () => {
    const before = await market.ledgerLength();
    const { results } = await runScenario("everyError", deps);
    expect(results.length).to.be.greaterThanOrEqual(15);
    expect(results.every((r) => !r.ok)).to.equal(true);

    // Only the scenario's own setup wrote records: no failed call added one.
    const added = (await market.ledgerLength()) - before;
    const setupRecords = await market.getRecords(before, 100);
    expect(setupRecords.every((r) => [Action.Registered, Action.Listed, Action.Reserved, Action.Revoked].includes(r.action))).to.equal(true);
    expect(added).to.equal(BigInt(setupRecords.length));
    expect((await market.verifyLedger())[0]).to.equal(true);
  });

  it("pendingReplacement mines the replacement and neither the original nor the dropped tx", async () => {
    const before = await market.ledgerLength();
    const r = await runScenario("pendingReplacement", deps);
    expect(r.originalMined).to.equal(false);
    expect(r.replacementMined).to.equal(true);
    expect(r.droppedMined).to.equal(false);
    expect(await market.ledgerLength()).to.equal(before); // nothing reached the ledger
    expect(await ethers.provider.send("hardhat_getAutomine", [])).to.equal(true); // restored
  });

  it("bulk creates two records per product", async () => {
    const out = await runScenario("bulk", deps, { count: 5 });
    expect(out.records).to.equal(10);
    expect(await market.ledgerLength()).to.equal(10n);
  });

  it("rejects an unknown scenario", async () => {
    await expect(runScenario("nope", deps)).to.be.rejectedWith(/Unknown scenario/);
  });
});
