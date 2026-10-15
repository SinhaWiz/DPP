// Writes packages/shared/test/fixtures/records.json: real records produced by the contract, used to
// prove that the TypeScript hash recipe matches the on-chain one byte for byte.
//
//   npx hardhat run scripts/export-fixture.js
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { runScenario } = require("./scenarios");

const OUT = path.join(__dirname, "..", "packages", "shared", "test", "fixtures", "records.json");

async function main() {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const market = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  const deps = { market, signers, log: () => {} };

  await runScenario("supplyChain", deps);
  await runScenario("escrowRevocations", deps);

  const records = (await market.getRecords(0, 1000)).map((r) => ({
    index: r.index.toString(),
    timestamp: r.timestamp.toString(),
    productId: r.productId.toString(),
    action: Number(r.action),
    actor: r.actor,
    counterparty: r.counterparty,
    price: r.price.toString(),
    prevHash: r.prevHash,
    hash: r.hash,
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ records }, null, 2) + "\n");
  console.log(`Wrote ${records.length} records to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
