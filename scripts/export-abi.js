// Writes packages/shared/src/contract.json: the market contract's ABI and storage layout.
// Committed so the shared package (and its tests) work without deploying anything.
// Re-run after changing the contracts:  npm run export:abi
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { readStorageLayout } = require("./lib/deploy");

const OUT = path.join(__dirname, "..", "packages", "shared", "src", "contract.json");

async function build(hre) {
  await hre.run("compile", { quiet: true });
  const artifact = await hre.artifacts.readArtifact("BuySellTraceability");
  return { abi: artifact.abi, storage: await readStorageLayout(hre.artifacts) };
}

async function main() {
  const contract = await build(hre);
  fs.writeFileSync(OUT, JSON.stringify(contract, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${contract.abi.length} ABI entries)`);
}

if (require.main === module || process.argv.some((a) => a.endsWith("export-abi.js"))) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { build, OUT };
