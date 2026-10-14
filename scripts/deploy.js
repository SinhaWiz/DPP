// Deploys to whichever network is selected with --network (e.g. localhost).
const { ethers } = require("hardhat");

async function main() {
  const c = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  await c.waitForDeployment();
  console.log("BuySellTraceability deployed to:", await c.getAddress());
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
