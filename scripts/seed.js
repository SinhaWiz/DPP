// Loads sample activity into the running dev chain: the supply-chain story, every escrow outcome,
// and (WITH_FAILURES=1) a set of deliberately failing transactions.
//
//   npm run dev:seed
//
// Against `--network localhost` it uses the contracts from the last `npm run dev:deploy`.
// On the in-memory network it deploys its own copy, which is handy for a quick dry run.
const hre = require("hardhat");
const { readDeployment } = require("./lib/deploy");
const { runScenario } = require("./scenarios");

async function connect() {
  const { ethers, network } = hre;
  if (network.name !== "localhost") {
    const market = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
    const rejecter = await (await ethers.getContractFactory("EtherRejecter")).deploy();
    return { market, rejecter };
  }

  const d = readDeployment();
  const genesis = await ethers.provider.getBlock(0);
  if (genesis.hash !== d.sessionId) {
    throw new Error("deployment.json belongs to a previous node session. Run `npm run dev:deploy` again.");
  }
  return {
    market: await ethers.getContractAt(d.contracts.market.abi, d.contracts.market.address),
    rejecter: await ethers.getContractAt(d.contracts.rejecter.abi, d.contracts.rejecter.address),
  };
}

async function main() {
  const signers = await hre.ethers.getSigners();
  const { market, rejecter } = await connect();
  const deps = { market, rejecter, signers };

  if ((await market.ledgerLength()) > 0n && process.env.FORCE_SEED !== "1") {
    console.log("Ledger already has records; skipping seed (set FORCE_SEED=1 to add more).");
    return;
  }

  await runScenario("supplyChain", deps);
  await runScenario("escrowRevocations", deps);
  if (process.env.WITH_FAILURES === "1") await runScenario("everyError", deps);

  const [valid] = await market.verifyLedger();
  console.log(`\nSeeded: ${await market.productCount()} products, ${await market.ledgerLength()} records. Ledger valid: ${valid}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
