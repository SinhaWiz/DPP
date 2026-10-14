// Runs a full Manufacturer → Distributor → Retailer → Customer supply chain
// on the in-process Hardhat network and prints the traceability trail.
const hre = require("hardhat");
const { ethers } = hre;

const ACTIONS = ["Registered", "Listed", "Delisted", "Sold"];

async function main() {
  const [manufacturer, distributor, retailer, customer] = await ethers.getSigners();
  const names = {
    [manufacturer.address]: "Manufacturer",
    [distributor.address]: "Distributor",
    [retailer.address]: "Retailer",
    [customer.address]: "Customer",
  };
  const who = (a) =>
    a === ethers.ZeroAddress ? "—" : `${names[a] || a} (${a.slice(0, 8)}…)`;

  const contract = await (await ethers.getContractFactory("BuySellTraceability")).deploy();
  await contract.waitForDeployment();
  console.log("Contract deployed at:", await contract.getAddress(), "\n");

  console.log("▶ Manufacturer registers 'Laptop'");
  await (await contract.connect(manufacturer).registerProduct("Laptop")).wait();

  const hops = [
    [manufacturer, distributor, "1.0"],
    [distributor, retailer, "1.5"],
    [retailer, customer, "2.0"],
  ];
  for (const [seller, buyer, eth] of hops) {
    const price = ethers.parseEther(eth);
    console.log(`▶ ${names[seller.address]} lists for ${eth} ETH, ${names[buyer.address]} buys`);
    await (await contract.connect(seller).listForSale(1, price)).wait();
    await (await contract.connect(buyer).buy(1, { value: price })).wait();
  }

  console.log("\n══════════════ Traceability trail for product #1 ══════════════");
  const product = await contract.getProduct(1);
  console.log(`Product: ${product.name} | current owner: ${who(product.owner)}\n`);

  for (const r of await contract.getProductHistory(1, 0, 100)) {
    console.log(`Block #${r.index}  [${ACTIONS[Number(r.action)]}]  ${new Date(Number(r.timestamp) * 1000).toISOString()}`);
    console.log(`  actor        : ${who(r.actor)}`);
    console.log(`  counterparty : ${who(r.counterparty)}`);
    console.log(`  price        : ${ethers.formatEther(r.price)} ETH`);
    console.log(`  prevHash     : ${r.prevHash}`);
    console.log(`  hash         : ${r.hash}\n`);
  }

  const [valid, brokenAt] = await contract.verifyLedger();
  console.log(valid ? "✔ Ledger integrity verified: all hashes and links are intact."
                    : `✘ Ledger is corrupted at record #${brokenAt}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
