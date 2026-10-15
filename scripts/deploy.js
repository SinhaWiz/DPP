// Deploys to whichever network is selected with --network (e.g. localhost).
// Against a local node it also writes packages/shared/src/generated/deployment.json,
// which the backend and frontend read (address, ABI, deploy block, storage slots, roles).
const hre = require("hardhat");
const { deployAll, outputPath } = require("./lib/deploy");

async function main() {
  const write = hre.network.name === "localhost" || process.env.WRITE_DEPLOYMENT === "1";
  const { deployment } = await deployAll(hre, { write });

  console.log("BuySellTraceability deployed to:", deployment.contracts.market.address);
  console.log("EtherRejecter       deployed to:", deployment.contracts.rejecter.address);
  console.log("Deploy block:", deployment.deployBlock, "| session:", deployment.sessionId.slice(0, 12) + "…");
  if (write) {
    console.log("Deployment file written:", outputPath());
    console.log("Next: `npm run dev:seed` to load sample data.");
  } else {
    console.log("(in-memory network: deployment file not written; set WRITE_DEPLOYMENT=1 to force)");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
