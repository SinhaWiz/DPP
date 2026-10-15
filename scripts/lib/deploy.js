// Deploys the contracts and (optionally) writes the deployment file the
// backend and frontend read. Shared by scripts/deploy.js and the lab reset.
const fs = require("fs");
const path = require("path");

const ROLES = require("../../packages/shared/src/roles.json");
const OUTPUT = path.join(__dirname, "..", "..", "packages", "shared", "src", "generated", "deployment.json");

const MARKET = "contracts/BuySellTraceability.sol:BuySellTraceability";
const REJECTER = "contracts/test/EtherRejecter.sol:EtherRejecter";

/** Reads the compiler's storage layout for the market contract from the build info. */
async function readStorageLayout(artifacts) {
  const info = await artifacts.getBuildInfo(MARKET);
  const out = info.output.contracts["contracts/BuySellTraceability.sol"].BuySellTraceability;
  const layout = out.storageLayout;

  const variables = {};
  for (const v of layout.storage) variables[v.label] = { slot: Number(v.slot), offset: v.offset, type: v.type };

  // Record struct: how many slots and where each member sits.
  const recordTypeId = Object.keys(layout.types).find((t) => t.startsWith("t_struct(Record)"));
  const record = layout.types[recordTypeId];
  return {
    variables,
    record: {
      slots: Number(record.numberOfBytes) / 32,
      members: record.members.map((m) => ({ name: m.label, slot: Number(m.slot), offset: m.offset })),
    },
  };
}

/**
 * @param {import("hardhat")} hre
 * @param {{ write?: boolean }} options write: persist deployment.json
 */
async function deployAll(hre, { write = false } = {}) {
  const { ethers, artifacts } = hre;

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) {
    throw new Error(`Refusing to deploy: expected chain id 31337 (a local Hardhat node), got ${chainId}.`);
  }

  const signers = await ethers.getSigners();

  const market = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  await market.waitForDeployment();
  const marketReceipt = await market.deploymentTransaction().wait();

  const rejecter = await (await ethers.getContractFactory("EtherRejecter")).deploy();
  await rejecter.waitForDeployment();

  const genesis = await ethers.provider.getBlock(0);
  const marketArtifact = await artifacts.readArtifact("BuySellTraceability");
  const rejecterArtifact = await artifacts.readArtifact("EtherRejecter");

  const roles = ROLES.map((r) => ({ ...r, address: signers[r.index].address }));
  roles.push({
    index: -1,
    name: "Broken Wallet",
    description: "A contract that refuses to receive ETH",
    address: await rejecter.getAddress(),
  });

  const deployment = {
    chainId,
    sessionId: genesis.hash,
    deployedAt: new Date().toISOString(),
    deployBlock: marketReceipt.blockNumber,
    contracts: {
      market: { address: await market.getAddress(), abi: marketArtifact.abi },
      rejecter: { address: await rejecter.getAddress(), abi: rejecterArtifact.abi },
    },
    storage: await readStorageLayout(artifacts),
    roles,
  };

  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(deployment, null, 2) + "\n");
  }
  return { deployment, market, rejecter, signers };
}

function readDeployment() {
  if (!fs.existsSync(OUTPUT)) {
    throw new Error("No deployment found. Run `npm run dev:deploy` against a running `npm run dev:node` first.");
  }
  return JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
}

module.exports = { deployAll, readDeployment, OUTPUT, ROLES };
